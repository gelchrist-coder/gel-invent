import { Fragment, useState, useEffect } from "react";
import { API_BASE, buildAuthHeaders, createBranch, fetchBranches, fetchWarehouses, resilientFetch } from "../api";
import { Branch, Warehouse } from "../types";
import { FrontendPermission, hasUserPermission, readStoredUser } from "../user-storage";

type ResponsibilityKey = "sales" | "products" | "inventory" | "customers" | "returns" | "procurement" | "reports" | "revenue" | "warehouses";

const RESPONSIBILITIES: Array<{
  key: ResponsibilityKey;
  label: string;
  description: string;
  permissions: FrontendPermission[];
}> = [
  { key: "sales", label: "Sales & Invoices", description: "Create sales, issue invoices, and send receipts.", permissions: ["process_sales", "send_sale_receipts", "view_catalog", "view_inventory"] },
  { key: "products", label: "Products", description: "View, add, and edit the product catalogue.", permissions: ["view_catalog", "manage_catalog"] },
  { key: "inventory", label: "Inventory", description: "View stock and record inventory adjustments.", permissions: ["view_catalog", "view_inventory", "manage_inventory"] },
  { key: "customers", label: "Customers & Credit", description: "View and manage customer credit accounts.", permissions: ["view_creditors", "manage_creditors"] },
  { key: "returns", label: "Sales Returns", description: "Process customer returns and refunds.", permissions: ["process_sales", "process_returns", "view_catalog", "view_inventory"] },
  { key: "procurement", label: "Purchases & Suppliers", description: "Manage suppliers, purchases, payments, and return outwards.", permissions: ["view_procurement", "manage_procurement"] },
  { key: "reports", label: "Reports", description: "View operational sales and inventory reports.", permissions: ["view_reports"] },
  { key: "revenue", label: "Revenue", description: "View revenue and profitability analysis.", permissions: ["view_revenue"] },
  { key: "warehouses", label: "Warehouses", description: "Operate warehouses and transfer warehouse stock.", permissions: ["view_warehouses", "manage_warehouses"] },
];

const ALL_RESPONSIBILITY_KEYS = RESPONSIBILITIES.map((responsibility) => responsibility.key);

function defaultResponsibilities(role: string): ResponsibilityKey[] {
  if (role === "Manager") return [...ALL_RESPONSIBILITY_KEYS];
  if (role === "Warehouse") return ["warehouses"];
  if (role === "Custom") return [];
  return ["sales"];
}

function permissionsForResponsibilities(keys: ResponsibilityKey[]): FrontendPermission[] {
  const selected = new Set(keys);
  return Array.from(new Set(
    RESPONSIBILITIES
      .filter((responsibility) => selected.has(responsibility.key))
      .flatMap((responsibility) => responsibility.permissions),
  )).sort();
}

function responsibilitiesForPermissions(permissions: string[]): ResponsibilityKey[] {
  const available = new Set(permissions);
  return RESPONSIBILITIES
    .filter((responsibility) => responsibility.permissions.every((permission) => available.has(permission)))
    .map((responsibility) => responsibility.key);
}

function ResponsibilityPicker({
  selected,
  onChange,
  warehouseOnly = false,
}: {
  selected: ResponsibilityKey[];
  onChange: (next: ResponsibilityKey[]) => void;
  warehouseOnly?: boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
      {RESPONSIBILITIES.map((responsibility) => {
        const checked = selected.includes(responsibility.key);
        const disabled = warehouseOnly && responsibility.key !== "warehouses";
        return (
          <label
            key={responsibility.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: 12,
              border: checked ? "1px solid #93c5fd" : "1px solid #e2e8f0",
              borderRadius: 8,
              background: checked ? "#eff6ff" : "#fff",
              opacity: disabled ? 0.45 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(
                checked
                  ? selected.filter((key) => key !== responsibility.key)
                  : [...selected, responsibility.key],
              )}
              style={{ width: 17, height: 17, marginTop: 1 }}
            />
            <span>
              <strong style={{ display: "block", fontSize: 13, color: "#1f2937" }}>{responsibility.label}</strong>
              <span style={{ display: "block", marginTop: 3, fontSize: 11, lineHeight: 1.4, color: "#64748b" }}>{responsibility.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

type Employee = {
  id: number;
  email: string;
  phone?: string | null;
  name: string;
  role: string;
  permissions: string[];
  branch_id?: number | null;
  warehouse_id?: number | null;
  is_active: boolean;
  created_at?: string;
};

export default function UserManagement() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branchName, setBranchName] = useState("");
  const [branchError, setBranchError] = useState("");
  const visibleBranches = branches;
  
  const currentUser = readStoredUser();
  const canManageEmployees = hasUserPermission("manage_employees", currentUser);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    role: "Sales",
    branch_id: "" as "" | number,
    warehouse_id: "" as "" | number,
    responsibilities: defaultResponsibilities("Sales"),
  });
  const [editingAccessEmployeeId, setEditingAccessEmployeeId] = useState<number | null>(null);
  const [editingResponsibilities, setEditingResponsibilities] = useState<ResponsibilityKey[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!canManageEmployees) {
      setLoading(false);
      return;
    }

    void Promise.all([loadEmployees(), loadBranches(), loadWarehouses()]);
  }, [canManageEmployees]);

  const loadBranches = async () => {
    try {
      const data = await fetchBranches();
      setBranches(data);
      // Default employee branch selection to first branch if not set.
      setFormData((prev) => {
        if (prev.branch_id !== "") return prev;
        const nextId = data[0]?.id ?? "";
        return { ...prev, branch_id: nextId };
      });
    } catch (err) {
      console.error("Error loading branches:", err);
    }
  };

  const loadEmployees = async () => {
    try {
      const response = await resilientFetch(`${API_BASE}/employees`, {
        headers: buildAuthHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setEmployees(data);
      }
    } catch (err) {
      console.error("Error loading employees:", err);
      setError("Users list took too long to load. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  const loadWarehouses = async () => {
    try {
      const data = await fetchWarehouses();
      setWarehouses(data.filter((warehouse) => warehouse.is_active));
      setFormData((previous) => previous.warehouse_id !== "" ? previous : { ...previous, warehouse_id: data.find((warehouse) => warehouse.is_active)?.id ?? "" });
    } catch (err) {
      console.error("Error loading warehouses:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!formData.name || !formData.email || !formData.password) {
      setError("Please fill in all fields");
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        role: formData.role,
        permissions: permissionsForResponsibilities(formData.responsibilities),
      };
      if (formData.phone.trim()) {
        payload.phone = formData.phone.trim();
      }
      if (typeof formData.branch_id === "number") {
        payload.branch_id = formData.branch_id;
      }
      if (formData.role === "Warehouse" && typeof formData.warehouse_id === "number") {
        payload.warehouse_id = formData.warehouse_id;
        delete payload.branch_id;
      }
      const response = await resilientFetch(`${API_BASE}/employees`, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setSuccess("Employee added successfully!");
        setFormData((prev) => ({
          name: "",
          email: "",
          phone: "",
          password: "",
          role: "Sales",
          branch_id: prev.branch_id,
          warehouse_id: prev.warehouse_id,
          responsibilities: defaultResponsibilities("Sales"),
        }));
        setShowAddForm(false);
        loadEmployees();
      } else {
        const data = await response.json();
        setError(data.detail || "Failed to add employee");
      }
    } catch {
      setError("Network error. Please try again.");
    }
  };

  const handleToggleActive = async (employeeId: number, currentStatus: boolean) => {
    try {
      const response = await resilientFetch(`${API_BASE}/employees/${employeeId}`, {
        method: "PATCH",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ is_active: !currentStatus }),
      });

      if (response.ok) {
        loadEmployees();
      }
    } catch {
      console.error("Error updating employee");
    }
  };

  const handleChangeEmployeeBranch = async (employeeId: number, branchId: number) => {
    try {
      const response = await resilientFetch(`${API_BASE}/employees/${employeeId}`, {
        method: "PATCH",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ branch_id: branchId }),
      });
      if (response.ok) {
        loadEmployees();
      }
    } catch (err) {
      console.error("Error changing employee branch:", err);
    }
  };

  const handleChangeEmployeeWarehouse = async (employeeId: number, warehouseId: number) => {
    try {
      const response = await resilientFetch(`${API_BASE}/employees/${employeeId}`, {
        method: "PATCH",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ warehouse_id: warehouseId }),
      });
      if (response.ok) loadEmployees();
    } catch (err) {
      console.error("Error changing employee warehouse:", err);
    }
  };

  const openEmployeeAccess = (employee: Employee) => {
    setEditingAccessEmployeeId(employee.id);
    setEditingResponsibilities(responsibilitiesForPermissions(employee.permissions ?? []));
    setError("");
    setSuccess("");
  };

  const saveEmployeeAccess = async (employee: Employee) => {
    try {
      const response = await resilientFetch(`${API_BASE}/employees/${employee.id}`, {
        method: "PATCH",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ permissions: permissionsForResponsibilities(editingResponsibilities) }),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.detail || "Failed to update employee responsibilities");
        return;
      }
      setEditingAccessEmployeeId(null);
      setEditingResponsibilities([]);
      setSuccess(`${employee.name}'s responsibilities were updated.`);
      await loadEmployees();
    } catch {
      setError("Network error. Please try again.");
    }
  };

  const handleCreateBranch = async () => {
    setBranchError("");
    const name = branchName.trim();
    if (!name) {
      setBranchError("Enter a branch name");
      return;
    }
    try {
      await createBranch({ name });
      setBranchName("");
      await loadBranches();
      window.dispatchEvent(new CustomEvent("branchesChanged"));
      setSuccess("Branch created successfully!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create branch";
      setBranchError(message);
    }
  };

  if (!canManageEmployees) {
    return (
      <div style={{ padding: 32 }}>
        <div
          style={{
            padding: 32,
            background: "#fee",
            border: "1px solid #fcc",
            borderRadius: 8,
            textAlign: "center",
          }}
        >
          <h2 style={{ color: "#c33", marginBottom: 8 }}>Access Denied</h2>
          <p style={{ color: "#666" }}>Your account does not have access to user management.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>User Management</h1>
          <p style={{ margin: "8px 0 0", color: "#5f6475" }}>Manage branch and warehouse users</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{
            padding: "12px 24px",
            background: "linear-gradient(135deg, #1f7aff, #0d5edb)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(31, 122, 255, 0.3)",
          }}
        >
          {showAddForm ? "Cancel" : "+ Add Employee"}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 16,
            background: "#fee",
            border: "1px solid #fcc",
            borderRadius: 8,
            color: "#c33",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            padding: 16,
            background: "#efe",
            border: "1px solid #cfc",
            borderRadius: 8,
            color: "#3c3",
            marginBottom: 16,
          }}
        >
          {success}
        </div>
      )}

      <div
        style={{
          background: "#fff",
          padding: 24,
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          marginBottom: 24,
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 700 }}>Branches</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="e.g., Accra Branch"
            style={{
              width: 260,
              padding: 10,
              border: "1px solid #d8dce8",
              borderRadius: 6,
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={handleCreateBranch}
            style={{
              padding: "10px 18px",
              background: "linear-gradient(135deg, #1f7aff, #0d5edb)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            + Create Branch
          </button>
          <div style={{ color: "#5f6475", fontSize: 13 }}>
            Current: {visibleBranches.map((b) => b.name).join(", ") || "No branches"}
          </div>
        </div>
        {branchError && <div style={{ marginTop: 10, color: "#c33", fontSize: 13 }}>{branchError}</div>}
      </div>

      {showAddForm && (
        <div
          style={{
            background: "#fff",
            padding: 24,
            borderRadius: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            marginBottom: 24,
          }}
        >
          <h2 style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 600 }}>Add New Employee</h2>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                  Full Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  style={{
                    width: "100%",
                    padding: 10,
                    border: "1px solid #d8dce8",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                  placeholder="e.g., Kwame Mensah"
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  style={{
                    width: "100%",
                    padding: 10,
                    border: "1px solid #d8dce8",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                  placeholder="e.g., kwame@example.com"
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  style={{
                    width: "100%",
                    padding: 10,
                    border: "1px solid #d8dce8",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                  placeholder="e.g., 0241234567"
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                  Password
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  style={{
                    width: "100%",
                    padding: 10,
                    border: "1px solid #d8dce8",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                  placeholder="Minimum 6 characters"
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                  Role
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => {
                    const role = e.target.value;
                    setFormData({ ...formData, role, responsibilities: defaultResponsibilities(role) });
                  }}
                  style={{
                    width: "100%",
                    padding: 10,
                    border: "1px solid #d8dce8",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                >
                  <option value="Sales">Sales Personnel</option>
                  <option value="Manager">Manager</option>
                  <option value="Warehouse">Warehouse User</option>
                  <option value="Custom">Custom Employee</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1f2937" }}>Responsibilities</div>
                <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                  The primary role selects a safe default. Add or remove responsibilities to control which areas this employee can use.
                </div>
              </div>
              <ResponsibilityPicker
                selected={formData.responsibilities}
                warehouseOnly={formData.role === "Warehouse"}
                onChange={(responsibilities) => setFormData({ ...formData, responsibilities })}
              />
              {formData.responsibilities.length === 0 && (
                <div style={{ marginTop: 8, color: "#b45309", fontSize: 12 }}>
                  This employee will only be able to sign in and view their account until a responsibility is selected.
                </div>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                {formData.role === "Warehouse" ? "Warehouse" : "Branch"}
              </label>
              {formData.role === "Warehouse" ? <select
                value={formData.warehouse_id === "" ? "" : String(formData.warehouse_id)}
                onChange={(e) => setFormData({ ...formData, warehouse_id: e.target.value ? Number(e.target.value) : "" })}
                style={{ width: "100%", padding: 10, border: "1px solid #d8dce8", borderRadius: 6, fontSize: 14 }}
                required
              >
                <option value="">Select Warehouse</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select> : <select
                value={formData.branch_id === "" ? "" : String(formData.branch_id)}
                onChange={(e) => {
                  const value = e.target.value;
                  setFormData({ ...formData, branch_id: value ? Number(value) : "" });
                }}
                style={{
                  width: "100%",
                  padding: 10,
                  border: "1px solid #d8dce8",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              >
                {visibleBranches.length === 0 ? (
                  <option value="">{branches[0]?.name ?? "Select Branch"}</option>
                ) : (
                  visibleBranches.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.name}
                    </option>
                  ))
                )}
              </select>}
              <div style={{ marginTop: 6, color: "#5f6475", fontSize: 12 }}>
                {formData.role === "Warehouse"
                  ? "This user will only see and control the assigned warehouse."
                  : "Employees are locked to their assigned branch."}
              </div>
            </div>
            <button
              type="submit"
              style={{
                padding: "12px 32px",
                background: "linear-gradient(135deg, #1f7aff, #0d5edb)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Add Employee
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#5f6475" }}>Loading employees...</div>
      ) : employees.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 60,
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
          <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600 }}>No Employees Yet</h3>
          <p style={{ margin: 0, color: "#5f6475" }}>Add your first sales personnel to get started</p>
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fbff", borderBottom: "2px solid #e6e9f2" }}>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Name
                </th>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Email
                </th>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Phone
                </th>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Role
                </th>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Assignment
                </th>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Status
                </th>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <Fragment key={employee.id}>
                <tr style={{ borderBottom: "1px solid #e6e9f2" }}>
                  <td style={{ padding: 16, fontSize: 14 }}>{employee.name}</td>
                  <td style={{ padding: 16, fontSize: 14, color: "#5f6475" }}>{employee.email}</td>
                  <td style={{ padding: 16, fontSize: 14, color: "#5f6475" }}>{employee.phone || "-"}</td>
                  <td style={{ padding: 16, fontSize: 14 }}>
                    <span
                      style={{
                        padding: "4px 12px",
                        background: employee.role === "Sales" ? "#e3f2fd" : "#f3e5f5",
                        color: employee.role === "Sales" ? "#1976d2" : "#7b1fa2",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {employee.role}
                    </span>
                  </td>
                  <td style={{ padding: 16, fontSize: 14 }}>
                    <select
                      value={String(employee.role === "Warehouse" ? employee.warehouse_id ?? "" : employee.branch_id ?? "")}
                      onChange={(e) => employee.role === "Warehouse"
                        ? handleChangeEmployeeWarehouse(employee.id, Number(e.target.value))
                        : handleChangeEmployeeBranch(employee.id, Number(e.target.value))}
                      style={{
                        width: "100%",
                        maxWidth: 220,
                        padding: 8,
                        border: "1px solid #d8dce8",
                        borderRadius: 6,
                        fontSize: 13,
                        background: "#fff",
                      }}
                    >
                      {employee.role === "Warehouse" ? (
                        warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)
                      ) : branches.length === 0 ? (
                        <option value={String(employee.branch_id ?? "")}>Current Branch</option>
                      ) : (
                        (() => {
                          const current = branches.find((b) => b.id === employee.branch_id);
                          const shouldIncludeCurrent = current && !visibleBranches.some((b) => b.id === current.id);
                          const options = shouldIncludeCurrent ? [...visibleBranches, current] : visibleBranches;
                          return options.map((b) => (
                            <option key={b.id} value={String(b.id)}>
                              {b.name}
                            </option>
                          ));
                        })()
                      )}
                    </select>
                  </td>
                  <td style={{ padding: 16, fontSize: 14 }}>
                    <span
                      style={{
                        padding: "4px 12px",
                        background: employee.is_active ? "#e8f5e9" : "#ffebee",
                        color: employee.is_active ? "#2e7d32" : "#c62828",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {employee.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: 16 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => editingAccessEmployeeId === employee.id ? setEditingAccessEmployeeId(null) : openEmployeeAccess(employee)}
                      style={{
                        padding: "6px 12px",
                        background: editingAccessEmployeeId === employee.id ? "#dbeafe" : "#eff6ff",
                        color: "#1d4ed8",
                        border: "1px solid #bfdbfe",
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {editingAccessEmployeeId === employee.id ? "Close Access" : "Manage Access"}
                    </button>
                    <button
                      onClick={() => handleToggleActive(employee.id, employee.is_active)}
                      style={{
                        padding: "6px 16px",
                        background: employee.is_active ? "#fff3e0" : "#e8f5e9",
                        color: employee.is_active ? "#e65100" : "#2e7d32",
                        border: "1px solid",
                        borderColor: employee.is_active ? "#ffcc80" : "#a5d6a7",
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {employee.is_active ? "Deactivate" : "Activate"}
                    </button>
                    </div>
                  </td>
                </tr>
                {editingAccessEmployeeId === employee.id && (
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #dbeafe" }}>
                    <td colSpan={7} style={{ padding: 18 }}>
                      <div style={{ marginBottom: 12 }}>
                        <strong style={{ display: "block", fontSize: 14, color: "#1f2937" }}>Responsibilities for {employee.name}</strong>
                        <span style={{ display: "block", marginTop: 3, fontSize: 12, color: "#64748b" }}>
                          Changes take effect the next time this employee refreshes or signs in.
                        </span>
                      </div>
                      <ResponsibilityPicker
                        selected={editingResponsibilities}
                        warehouseOnly={employee.role === "Warehouse"}
                        onChange={setEditingResponsibilities}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          onClick={() => setEditingAccessEmployeeId(null)}
                          style={{ padding: "8px 14px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
                        >
                          Cancel
                        </button>
                        <button type="button" className="button" onClick={() => void saveEmployeeAccess(employee)}>
                          Save Responsibilities
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
