type Metrics = {
  total_revenue: number;
  cash_revenue: number;
  credit_revenue: number;
  total_profit: number;
  total_losses: number;
  actual_profit: number;
  total_cost: number;
  profit_margin: number;
  actual_profit_margin: number;
  sales_count: number;
  avg_transaction: number;
  revenue_growth: number;
};

type Props = {
  metrics: Metrics;
};

export default function RevenueMetrics({ metrics }: Props) {
  const formatCurrency = (value: number) => `GHS ${value.toFixed(2)}`;
  const formatPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

  return (
    <div>
      {/* First Row - Main Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 16 }}>
        {/* Total Revenue */}
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                backgroundColor: "#dbeafe",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}
            >
              💰
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Total Revenue</p>
              <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700 }}>
                {formatCurrency(metrics.total_revenue)}
              </p>
              {metrics.revenue_growth !== 0 && (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12,
                    fontWeight: 600,
                    color: metrics.revenue_growth >= 0 ? "#10b981" : "#ef4444",
                  }}
                >
                  {formatPercent(metrics.revenue_growth)} vs previous
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Cash Revenue */}
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                backgroundColor: "#d1fae5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}
            >
              💵
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Cash Received</p>
              <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#10b981" }}>
                {formatCurrency(metrics.cash_revenue)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                {metrics.total_revenue > 0 ? ((metrics.cash_revenue / metrics.total_revenue) * 100).toFixed(1) : 0}% of total
              </p>
            </div>
          </div>
        </div>

        {/* Credit (Accounts Receivable) */}
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                backgroundColor: "#fef3c7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}
            >
              📝
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Credit (Pending)</p>
              <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#f59e0b" }}>
                {formatCurrency(metrics.credit_revenue)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                Accounts Receivable
              </p>
            </div>
          </div>
        </div>

        {/* Sales Count */}
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                backgroundColor: "#e0e7ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}
            >
              🛒
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Total Sales</p>
              <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700 }}>
                {metrics.sales_count}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                Avg: {formatCurrency(metrics.avg_transaction)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Second Row - Profit Analysis */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {/* Gross Profit */}
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 20,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Gross Profit (Before Losses)</p>
            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#10b981" }}>
              {formatCurrency(metrics.total_profit)}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
              Margin: {metrics.profit_margin.toFixed(1)}%
            </p>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            Revenue - COGS = Gross Profit
          </div>
        </div>

        {/* Losses */}
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 20,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Losses (Expired/Damaged)</p>
            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#ef4444" }}>
              -{formatCurrency(metrics.total_losses)}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
              Write-offs & Spoilage
            </p>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            From expired, damaged or lost goods
          </div>
        </div>

        {/* Net Profit */}
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 20,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Actual Profit (After Losses)</p>
            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: metrics.actual_profit >= 0 ? "#10b981" : "#ef4444" }}>
              {formatCurrency(metrics.actual_profit)}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
              Margin: {metrics.actual_profit_margin.toFixed(1)}%
            </p>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            Gross Profit - Losses = Net Profit
          </div>
        </div>

        {/* COGS */}
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 20,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Cost of Goods Sold</p>
            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#6b7280" }}>
              {formatCurrency(metrics.total_cost)}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
              {metrics.total_revenue > 0 ? ((metrics.total_cost / metrics.total_revenue) * 100).toFixed(1) : 0}% of revenue
            </p>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            Direct costs of products sold
          </div>
        </div>
      </div>
    </div>
  );
}
