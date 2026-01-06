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

// SVG Icons for KPI cards
const TrendingUpIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const DollarIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const CreditCardIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const ShoppingCartIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

const TrendingDownIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
    <polyline points="17 18 23 18 23 12" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const PackageIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

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
                color: "#2563eb",
              }}
            >
              <TrendingUpIcon />
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
                color: "#059669",
              }}
            >
              <DollarIcon />
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
                color: "#d97706",
              }}
            >
              <CreditCardIcon />
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
                color: "#4f46e5",
              }}
            >
              <ShoppingCartIcon />
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
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                backgroundColor: "#d1fae5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#10b981",
                flexShrink: 0,
              }}
            >
              <CheckCircleIcon />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Gross Profit (Before Losses)</p>
              <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#10b981" }}>
                {formatCurrency(metrics.total_profit)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                Margin: {metrics.profit_margin.toFixed(1)}%
              </p>
            </div>
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
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                backgroundColor: "#fee2e2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ef4444",
                flexShrink: 0,
              }}
            >
              <TrendingDownIcon />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Losses (Expired/Damaged)</p>
              <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#ef4444" }}>
                -{formatCurrency(metrics.total_losses)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                Write-offs & Spoilage
              </p>
            </div>
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
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                backgroundColor: metrics.actual_profit >= 0 ? "#d1fae5" : "#fee2e2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: metrics.actual_profit >= 0 ? "#10b981" : "#ef4444",
                flexShrink: 0,
              }}
            >
              <TrendingUpIcon />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Actual Profit (After Losses)</p>
              <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: metrics.actual_profit >= 0 ? "#10b981" : "#ef4444" }}>
                {formatCurrency(metrics.actual_profit)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                Margin: {metrics.actual_profit_margin.toFixed(1)}%
              </p>
            </div>
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
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                backgroundColor: "#f3f4f6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#6b7280",
                flexShrink: 0,
              }}
            >
              <PackageIcon />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Cost of Goods Sold</p>
              <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#6b7280" }}>
                {formatCurrency(metrics.total_cost)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                {metrics.total_revenue > 0 ? ((metrics.total_cost / metrics.total_revenue) * 100).toFixed(1) : 0}% of revenue
              </p>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            Direct costs of products sold
          </div>
        </div>
      </div>
    </div>
  );
}
