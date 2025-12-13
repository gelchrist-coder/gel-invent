import { useEffect, useState } from "react";
import { Product } from "../types";
import { fetchMovements } from "../api";
import { useAppCategories } from "../categories";

type Props = {
  products: Product[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onEdit: (id: number, updates: Partial<Product>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onStockAdjust: (productId: number, change: number, reason: string, expiry_date?: string, location?: string) => Promise<void>;
  searchTerm: string;
  filterCategory: string;
  filterExpiry: string;
  userRole?: string;
};

export default function ProductList({ 
  products, 
  onEdit,
  onDelete,
  onStockAdjust,
  searchTerm,
  filterCategory,
  filterExpiry,
  userRole = "Admin",
}: Props) {
  const isAdmin = userRole === "Admin";
  const categoryOptions = useAppCategories();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [adjustment, setAdjustment] = useState({ quantity: "", reason: "", expiry_date: "", location: "Main Store" });
  const [stockData, setStockData] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);

  // Fetch stock movements for all products
  useEffect(() => {
    const loadStockData = async () => {
      const stockMap: Record<number, number> = {};
      for (const product of products) {
        try {
          const movements = await fetchMovements(product.id);
          const totalStock = movements.reduce((sum, m) => sum + m.change, 0);
          stockMap[product.id] = totalStock;
        } catch {
          stockMap[product.id] = 0;
        }
      }
      setStockData(stockMap);
    };
    if (products.length > 0) {
      loadStockData();
    }
  }, [products]);

  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setEditForm({
      name: product.name,
      sku: product.sku,
      description: product.description,
      unit: product.unit,
      category: product.category,
      expiry_date: product.expiry_date,
      cost_price: product.cost_price,
      pack_cost_price: product.pack_cost_price,
      selling_price: product.selling_price,
      pack_selling_price: product.pack_selling_price,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (id: number) => {
    if (!editForm.name?.trim()) {
      alert("Product name is required");
      return;
    }
    if (!editForm.sku?.trim()) {
      alert("SKU is required");
      return;
    }
    setBusy(true);
    try {
      await onEdit(id, editForm);
      setEditingId(null);
      setEditForm({});
    } catch (err) {
      alert((err as Error).message || "Failed to update product");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (product: Product) => {
    if (!confirm(`Are you sure you want to delete "${product.name}"? This will also delete all associated stock movements.`)) {
      return;
    }
    setBusy(true);
    try {
      await onDelete(product.id);
    } catch (err) {
      alert((err as Error).message || "Failed to delete product");
    } finally {
      setBusy(false);
    }
  };

  const startAdjustment = (productId: number) => {
    const product = products.find(p => p.id === productId);
    setAdjustingId(productId);
    setAdjustment({ quantity: "", reason: "", expiry_date: product?.expiry_date || "", location: "Main Store" });
  };

  const cancelAdjustment = () => {
    setAdjustingId(null);
    setAdjustment({ quantity: "", reason: "", expiry_date: "", location: "Main Store" });
  };

  const saveAdjustment = async (productId: number) => {
    const qty = parseFloat(adjustment.quantity);
    if (isNaN(qty) || qty === 0) {
      alert("Please enter a valid quantity");
      return;
    }
    if (!adjustment.reason.trim()) {
      alert("Please provide a reason for the adjustment");
      return;
    }
    if (adjustment.reason === "New Stock" && !adjustment.expiry_date) {
      alert("Please set an expiry date for new stock");
      return;
    }
    setBusy(true);
    try {
      await onStockAdjust(productId, qty, adjustment.reason, adjustment.expiry_date || undefined, adjustment.location);
      setAdjustingId(null);
      setAdjustment({ quantity: "", reason: "", expiry_date: "", location: "Main Store" });
      // Refresh stock data
      const movements = await fetchMovements(productId);
      const totalStock = movements.reduce((sum, m) => sum + m.change, 0);
      setStockData(prev => ({ ...prev, [productId]: totalStock }));
    } catch (err) {
      alert((err as Error).message || "Failed to adjust stock");
    } finally {
      setBusy(false);
    }
  };

  const calculateProfitMargin = (costPrice: number | null | undefined, sellingPrice: number | null | undefined): string => {
    if (!costPrice || !sellingPrice) return "-";
    const cost = Number(costPrice);
    const selling = Number(sellingPrice);
    if (cost === 0) return "-";
    const margin = ((selling - cost) / cost) * 100;
    return `${margin.toFixed(1)}%`;
  };

  // Filter products based on search and filters
  const filteredProducts = products.filter((p) => {
    // Search filter
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm || 
      p.name.toLowerCase().includes(searchLower) ||
      p.sku.toLowerCase().includes(searchLower) ||
      (p.description && p.description.toLowerCase().includes(searchLower));

    // Category filter
    const matchesCategory = filterCategory === "all" || p.category === filterCategory;

    // Expiry filter
    let matchesExpiry = true;
    if (filterExpiry === "expired") {
      matchesExpiry = p.expiry_date ? new Date(p.expiry_date) < new Date() : false;
    } else if (filterExpiry === "expiring") {
      matchesExpiry = p.expiry_date ? 
        new Date(p.expiry_date) >= new Date() && 
        new Date(p.expiry_date) <= new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) : 
        false;
    } else if (filterExpiry === "fresh") {
      matchesExpiry = !p.expiry_date || 
        new Date(p.expiry_date) > new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    }

    return matchesSearch && matchesCategory && matchesExpiry;
  });

  if (!products.length) {
    return (
      <div className="card">
        <h2 className="section-title">Products</h2>
        <p style={{ margin: 0, color: "#4a5368" }}>No products yet. Create one to get started.</p>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Edit Product Modal */}
      {editingId !== null && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={cancelEdit}
        >
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 24,
              maxWidth: 500,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 600 }}>
              Edit Product - {products.find(p => p.id === editingId)?.name}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Product Name *
                </span>
                <input
                  className="input"
                  type="text"
                  value={editForm.name || ""}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Product name"
                  autoFocus
                  style={{ fontSize: 14, padding: 10 }}
                />
              </label>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  SKU *
                </span>
                <input
                  className="input"
                  type="text"
                  value={editForm.sku || ""}
                  onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                  placeholder="SKU"
                  style={{ fontSize: 14, padding: 10 }}
                />
              </label>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Category
                </span>
                <input
                  className="input"
                  type="text"
                  value={editForm.category || ""}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  placeholder="e.g., Groceries, Beverages"
                  list="edit-category-suggestions"
                  style={{ fontSize: 14, padding: 10 }}
                />
                <datalist id="edit-category-suggestions">
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </label>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Description
                </span>
                <textarea
                  className="input"
                  value={editForm.description || ""}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Optional description"
                  rows={3}
                  style={{ fontSize: 14, padding: 10, resize: "vertical" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Cost Price (₵) - Per Piece
                  </span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.cost_price ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, cost_price: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="0.00"
                    style={{ fontSize: 14, padding: 10 }}
                  />
                </label>
                <label>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Selling Price (₵) - Per Piece
                  </span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.selling_price ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, selling_price: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="0.00"
                    style={{ fontSize: 14, padding: 10 }}
                  />
                </label>
              </div>
              {editForm.unit !== "pcs" && editForm.unit !== "unit" && products.find(p => p.id === editingId)?.pack_size && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label>
                    <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                      Pack Cost Price (₵)
                    </span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.pack_cost_price ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, pack_cost_price: e.target.value ? parseFloat(e.target.value) : null })}
                      placeholder="0.00"
                      style={{ fontSize: 14, padding: 10 }}
                    />
                    <small style={{ color: "#6b7280", fontSize: 12, display: "block", marginTop: 4 }}>
                      Cost per {editForm.unit} ({products.find(p => p.id === editingId)?.pack_size} pieces)
                    </small>
                  </label>
                  <label>
                    <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                      Pack Selling Price (₵)
                    </span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.pack_selling_price ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, pack_selling_price: e.target.value ? parseFloat(e.target.value) : null })}
                      placeholder="0.00"
                      style={{ fontSize: 14, padding: 10 }}
                    />
                    <small style={{ color: "#6b7280", fontSize: 12, display: "block", marginTop: 4 }}>
                      Selling price per {editForm.unit} ({products.find(p => p.id === editingId)?.pack_size} pieces)
                    </small>
                  </label>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Unit
                  </span>
                  <input
                    className="input"
                    type="text"
                    value={editForm.unit || ""}
                    onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                    placeholder="e.g., pcs, kg, liters"
                    style={{ fontSize: 14, padding: 10 }}
                  />
                </label>
                <label>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Expiry Date
                  </span>
                  <input
                    className="input"
                    type="date"
                    value={editForm.expiry_date || ""}
                    onChange={(e) => setEditForm({ ...editForm, expiry_date: e.target.value })}
                    style={{ fontSize: 14, padding: 10 }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className="button"
                  onClick={() => saveEdit(editingId)}
                  disabled={busy}
                  style={{ flex: 1, background: "#3b82f6", fontSize: 14 }}
                >
                  ✓ Save Changes
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    fontSize: 14,
                    background: "transparent",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustingId !== null && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={cancelAdjustment}
        >
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              width: "100%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 600 }}>
              Adjust Stock - {products.find(p => p.id === adjustingId)?.name}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Quantity Change
                </span>
                <input
                  className="input"
                  type="number"
                  step="1"
                  value={adjustment.quantity}
                  onChange={(e) => setAdjustment({ ...adjustment, quantity: e.target.value })}
                  placeholder="+50 or -10"
                  autoFocus
                  style={{ fontSize: 14, padding: 10 }}
                />
                <small style={{ color: "#6b7280", fontSize: 12, display: "block", marginTop: 4 }}>
                  Use + for adding stock, - for reducing stock
                </small>
              </label>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Reason
                </span>
                <select
                  className="input"
                  value={adjustment.reason}
                  onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })}
                  style={{ fontSize: 14, padding: 10 }}
                >
                  <option value="">Select reason...</option>
                  <option value="New Stock">New Stock</option>
                  <option value="Expired">Expired</option>
                  <option value="Damaged">Damaged</option>
                  <option value="Returned">Returned</option>
                  <option value="Correction">Correction</option>
                  <option value="Lost/Stolen">Lost/Stolen</option>
                </select>
              </label>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Location/Warehouse
                </span>
                <select
                  className="input"
                  value={adjustment.location}
                  onChange={(e) => setAdjustment({ ...adjustment, location: e.target.value })}
                  style={{ fontSize: 14, padding: 10 }}
                >
                  <option value="Main Store">Main Store</option>
                  <option value="Warehouse A">Warehouse A</option>
                  <option value="Warehouse B">Warehouse B</option>
                  <option value="Cold Storage">Cold Storage</option>
                  <option value="Display Area">Display Area</option>
                  <option value="Back Room">Back Room</option>
                </select>
              </label>
              {adjustment.reason === "New Stock" && (
                <label>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Expiry Date *
                  </span>
                  <input
                    className="input"
                    type="date"
                    value={adjustment.expiry_date}
                    onChange={(e) => setAdjustment({ ...adjustment, expiry_date: e.target.value })}
                    style={{ fontSize: 14, padding: 10 }}
                  />
                  <small style={{ color: "#6b7280", fontSize: 12, display: "block", marginTop: 4 }}>
                    Set the expiry date for this new stock batch
                  </small>
                </label>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className="button"
                  onClick={() => saveAdjustment(adjustingId)}
                  disabled={busy}
                  style={{ flex: 1, background: "#10b981", fontSize: 14 }}
                >
                  ✓ Adjust Stock
                </button>
                <button
                  onClick={cancelAdjustment}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    fontSize: 14,
                    background: "transparent",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Products</h2>
        <span style={{ fontSize: 14, color: "#6b7280" }}>
          Showing {filteredProducts.length} of {products.length}
        </span>
      </div>
      
      {filteredProducts.length === 0 ? (
        <p style={{ margin: 0, color: "#4a5368", textAlign: "center", padding: "40px 0" }}>
          {searchTerm || filterCategory !== "all" || filterExpiry !== "all" 
            ? "No products match your filters" 
            : "No products yet. Create one to get started."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ 
            width: "100%", 
            borderCollapse: "collapse",
            fontSize: 14,
          }}>
            <thead>
              <tr style={{ 
                background: "#f8f9fc", 
                borderBottom: "2px solid #e5e7eb",
              }}>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Name</th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#374151" }}>SKU</th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Category</th>
                <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Stock</th>
                <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Cost Price</th>
                <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Selling Price</th>
                <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Profit Margin</th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Created By</th>
                <th style={{ padding: "12px", textAlign: "center", fontWeight: 600, color: "#374151", width: "180px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => {
                const stock = stockData[p.id] ?? 0;
                const profitMargin = calculateProfitMargin(p.cost_price, p.selling_price);

                return (
                  <tr key={p.id} style={{ 
                    borderBottom: "1px solid #e5e7eb",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#f9fafb"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "12px", fontWeight: 500, color: "#111827" }}>
                      {p.name}
                    </td>
                    <td style={{ padding: "12px", color: "#6b7280", fontFamily: "monospace", fontSize: 13 }}>
                      {p.sku}
                    </td>
                    <td style={{ padding: "12px", color: "#6b7280" }}>
                      <span style={{ 
                        background: "#f3f4f6", 
                        padding: "4px 8px", 
                        borderRadius: 4, 
                        fontSize: 12,
                        fontWeight: 500,
                      }}>
                        {p.category || "General"}
                      </span>
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontWeight: 500 }}>
                      <span style={{ 
                        color: stock > 0 ? "#059669" : "#dc2626",
                        background: stock > 0 ? "#d1fae5" : "#fee2e2",
                        padding: "4px 8px",
                        borderRadius: 4,
                        fontSize: 13,
                      }}>
                        {stock}
                      </span>
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", color: "#374151" }}>
                      {p.cost_price ? `₵${Number(p.cost_price).toFixed(2)}` : "-"}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", color: "#374151", fontWeight: 500 }}>
                      {p.selling_price ? `₵${Number(p.selling_price).toFixed(2)}` : "-"}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontWeight: 500 }}>
                      <span style={{
                        color: profitMargin !== "-" && parseFloat(profitMargin) > 0 ? "#059669" : "#6b7280",
                      }}>
                        {profitMargin}
                      </span>
                    </td>
                    <td style={{ padding: "12px", color: "#6b7280", fontSize: 13 }}>
                      <span style={{ 
                        background: "#eff6ff", 
                        padding: "4px 8px", 
                        borderRadius: 4, 
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#1e40af",
                      }}>
                        {p.created_by_name || "Unknown"}
                      </span>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                        {isAdmin && (
                          <button
                            onClick={() => startEdit(p)}
                            disabled={busy}
                            style={{
                              padding: "6px 12px",
                              fontSize: 12,
                              background: "#3b82f6",
                              color: "white",
                              border: "none",
                              borderRadius: 6,
                              cursor: busy ? "not-allowed" : "pointer",
                              fontWeight: 500,
                            }}
                          title="Edit product"
                          >
                          ✏️ Edit
                          </button>
                        )}
                        <button
                          onClick={() => startAdjustment(p.id)}
                          disabled={busy}
                          style={{
                            padding: "6px 12px",
                            fontSize: 12,
                            background: "#10b981",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            cursor: busy ? "not-allowed" : "pointer",
                            fontWeight: 500,
                          }}
                          title="Adjust stock"
                        >
                          📦 Stock
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          disabled={busy}
                          style={{
                            padding: "6px 12px",
                            fontSize: 12,
                            background: "#ef4444",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            cursor: busy ? "not-allowed" : "pointer",
                            fontWeight: 500,
                          }}
                          title="Delete product"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
