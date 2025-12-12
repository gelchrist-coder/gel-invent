type ProductData = {
  product_id: number;
  product_name: string;
  sku: string;
  quantity_sold: number;
  revenue: number;
  cost: number;
  profit: number;
  profit_margin: number;
};

type Props = {
  products: ProductData[];
};

export default function TopProducts({ products }: Props) {
  const formatCurrency = (value: number) => `GHS ${value.toFixed(2)}`;

  if (products.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>
        No product sales data available
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "#f9fafb" }}>
            <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb", width: 50 }}>
              #
            </th>
            <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
              Product
            </th>
            <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
              SKU
            </th>
            <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb" }}>
              Qty Sold
            </th>
            <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb" }}>
              Revenue
            </th>
            <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb" }}>
              Cost
            </th>
            <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb" }}>
              Profit
            </th>
            <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb" }}>
              Margin
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((product, index) => (
            <tr
              key={product.product_id}
              style={{
                borderBottom: "1px solid #e5e7eb",
                backgroundColor: index < 3 ? "#fef3c7" : "white",
              }}
            >
              <td style={{ padding: 12, fontSize: 14, fontWeight: 600 }}>
                {index === 0 && "🥇"}
                {index === 1 && "🥈"}
                {index === 2 && "🥉"}
                {index > 2 && index + 1}
              </td>
              <td style={{ padding: 12, fontSize: 14, fontWeight: 500 }}>
                {product.product_name}
              </td>
              <td style={{ padding: 12, fontSize: 14, color: "#6b7280" }}>
                {product.sku}
              </td>
              <td style={{ padding: 12, textAlign: "right", fontSize: 14 }}>
                {product.quantity_sold.toFixed(2)}
              </td>
              <td style={{ padding: 12, textAlign: "right", fontSize: 14, fontWeight: 600 }}>
                {formatCurrency(product.revenue)}
              </td>
              <td style={{ padding: 12, textAlign: "right", fontSize: 14, color: "#ef4444" }}>
                {formatCurrency(product.cost)}
              </td>
              <td
                style={{
                  padding: 12,
                  textAlign: "right",
                  fontSize: 14,
                  fontWeight: 600,
                  color: product.profit >= 0 ? "#10b981" : "#ef4444",
                }}
              >
                {formatCurrency(product.profit)}
              </td>
              <td style={{ padding: 12, textAlign: "right", fontSize: 14 }}>
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    backgroundColor:
                      product.profit_margin >= 30
                        ? "#d1fae5"
                        : product.profit_margin >= 15
                          ? "#fef3c7"
                          : "#fee2e2",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {product.profit_margin.toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {products.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
          No sales data available
        </div>
      )}
    </div>
  );
}
