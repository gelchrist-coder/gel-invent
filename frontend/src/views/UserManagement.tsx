import { useState, useEffect } from "react";
import { API_BASE } from "../api";

type Employee = {
  id: number;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at?: string;
};

export default function UserManagement() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Check if current user is Admin
  const currentUser = localStorage.getItem("user");
  const userRole = currentUser ? JSON.parse(currentUser).role : null;
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "Sales",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE}/employees/`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setEmployees(data);
      }
    } catch (err) {
      console.error("Error loading employees:", err);
    } finally {
      setLoading(false);
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
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE}/employees/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setSuccess("Employee added successfully!");
        setFormData({ name: "", email: "", password: "", role: "Sales" });
        setShowAddForm(false);
        loadEmployees();
      } else {
        const data = await response.json();
        setError(data.detail || "Failed to add employee");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    }
  };

  const handleToggleActive = async (employeeId: number, currentStatus: boolean) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE}/employees/${employeeId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_active: !currentStatus }),
      });

      if (response.ok) {
        loadEmployees();
      }
    } catch (err) {
      console.error("Error updating employee:", err);
    }
  };

  // Block access for non-Admin users
  if (userRole !== "Admin") {
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
          <p style={{ color: "#666" }}>Only business owners can manage employees.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>User Management</h1>
          <p style={{ margin: "8px 0 0", color: "#5f6475" }}>Manage your sales personnel</p>
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
          {showAddForm ? "✕ Cancel" : "+ Add Employee"}
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
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
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
                </select>
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
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fbff", borderBottom: "2px solid #e6e9f2" }}>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Name
                </th>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Email
                </th>
                <th style={{ padding: 16, textAlign: "left", fontSize: 13, fontWeight: 600, color: "#5f6475" }}>
                  Role
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
                <tr key={employee.id} style={{ borderBottom: "1px solid #e6e9f2" }}>
                  <td style={{ padding: 16, fontSize: 14 }}>{employee.name}</td>
                  <td style={{ padding: 16, fontSize: 14, color: "#5f6475" }}>{employee.email}</td>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
