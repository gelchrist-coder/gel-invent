type PaymentData = {
  method: string;
  revenue: number;
};

type Props = {
  data: PaymentData[];
};

export default function PaymentMethodBreakdown({ data }: Props) {
  const formatCurrency = (value: number) => `GHS ${value.toFixed(2)}`;

  if (data.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>
        No payment data available
      </div>
    );
  }

  const totalRevenue = data.reduce((sum, item) => sum + item.revenue, 0);

  const getMethodIcon = (method: string) => {
    switch (method.toLowerCase()) {
      case "cash":
        return "💵";
      case "card":
        return "💳";
      case "mobile_money":
        return "📱";
      case "bank_transfer":
        return "🏦";
      case "credit":
        return "📝";
      default:
        return "💰";
    }
  };

  const getMethodColor = (index: number) => {
    const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
    return colors[index % colors.length];
  };

  const formatMethodName = (method: string) => {
    return method
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      {/* Payment Method Cards */}
      <div style={{ display: "grid", gap: 12 }}>
        {data.map((item, index) => {
          const percentage = totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0;
          const color = getMethodColor(index);

          return (
            <div
              key={item.method}
              style={{
                backgroundColor: "white",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                padding: 16,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  backgroundColor: `${color}20`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                }}
              >
                {getMethodIcon(item.method)}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                  {formatMethodName(item.method)}
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700, color }}>
                  {formatCurrency(item.revenue)}
                </p>
                <div
                  style={{
                    marginTop: 8,
                    height: 6,
                    backgroundColor: "#e5e7eb",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${percentage}%`,
                      backgroundColor: color,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color }}>
                  {percentage.toFixed(1)}%
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pie Chart */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: 240, height: 240 }}>
          <svg width="240" height="240" viewBox="0 0 240 240">
            {data.map((item, index) => {
              const percentage = totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0;
              const color = getMethodColor(index);
              
              // Calculate cumulative percentage for this slice
              const cumulativePercentage = data
                .slice(0, index)
                .reduce((sum, d) => sum + (d.revenue / totalRevenue) * 100, 0);
              
              // Convert percentage to angle (360 degrees = 100%)
              const startAngle = (cumulativePercentage / 100) * 360 - 90;
              const endAngle = ((cumulativePercentage + percentage) / 100) * 360 - 90;
              
              // Convert angles to radians
              const startRad = (startAngle * Math.PI) / 180;
              const endRad = (endAngle * Math.PI) / 180;
              
              // Calculate path
              const radius = 100;
              const centerX = 120;
              const centerY = 120;
              
              const x1 = centerX + radius * Math.cos(startRad);
              const y1 = centerY + radius * Math.sin(startRad);
              const x2 = centerX + radius * Math.cos(endRad);
              const y2 = centerY + radius * Math.sin(endRad);
              
              const largeArc = percentage > 50 ? 1 : 0;
              
              const pathData = [
                `M ${centerX} ${centerY}`,
                `L ${x1} ${y1}`,
                `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
                "Z",
              ].join(" ");
              
              return (
                <g key={item.method}>
                  <path
                    d={pathData}
                    fill={color}
                    stroke="white"
                    strokeWidth="2"
                    opacity="0.9"
                  />
                </g>
              );
            })}
            {/* Center circle */}
            <circle cx="120" cy="120" r="50" fill="white" />
            <text
              x="120"
              y="115"
              textAnchor="middle"
              fontSize="12"
              fill="#6b7280"
              fontWeight="500"
            >
              Total
            </text>
            <text
              x="120"
              y="135"
              textAnchor="middle"
              fontSize="16"
              fill="#111827"
              fontWeight="700"
            >
              {formatCurrency(totalRevenue)}
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}
