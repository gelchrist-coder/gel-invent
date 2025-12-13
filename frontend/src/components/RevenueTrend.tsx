type DailyData = {
  date: string;
  revenue: number;
};

type Props = {
  data: DailyData[];
};

export default function RevenueTrend({ data }: Props) {
  if (data.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>
        No revenue data available for this period
      </div>
    );
  }

  const maxRevenue = Math.max(...data.map((d) => d.revenue));
  const chartHeight = 200;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  const formatCurrency = (value: number) => `GHS ${value.toFixed(0)}`;

  return (
    <div>
      {/* Chart */}
      <div style={{ position: "relative", height: chartHeight + 40, marginBottom: 8 }}>
        {/* Y-axis labels */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 40,
            width: 60,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          <span>{formatCurrency(maxRevenue)}</span>
          <span>{formatCurrency(maxRevenue / 2)}</span>
          <span>GHS 0</span>
        </div>

        {/* Chart area */}
        <div
          style={{
            position: "absolute",
            left: 70,
            right: 0,
            top: 0,
            bottom: 40,
            borderLeft: "1px solid #e5e7eb",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          {/* Grid lines */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "50%",
              borderTop: "1px dashed #e5e7eb",
            }}
          />

          {/* Bars */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              display: "flex",
              alignItems: "flex-end",
              gap: data.length > 30 ? 2 : 4,
              padding: "0 8px",
            }}
          >
            {data.map((item) => {
              const barHeight = maxRevenue > 0 ? (item.revenue / maxRevenue) * chartHeight : 0;
              const isWeekend = new Date(item.date).getDay() === 0 || new Date(item.date).getDay() === 6;

              return (
                <div
                  key={item.date}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                  title={`${formatDate(item.date)}: ${formatCurrency(item.revenue)}`}
                >
                  <div
                    style={{
                      width: "100%",
                      height: barHeight,
                      backgroundColor: isWeekend ? "#93c5fd" : "#3b82f6",
                      borderRadius: "2px 2px 0 0",
                      transition: "all 0.2s",
                      minHeight: item.revenue > 0 ? 2 : 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#1d4ed8";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = isWeekend ? "#93c5fd" : "#3b82f6";
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* X-axis labels */}
        <div
          style={{
            position: "absolute",
            left: 70,
            right: 0,
            bottom: 0,
            height: 40,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11,
            color: "#6b7280",
            padding: "0 8px",
          }}
        >
          {data.length <= 7 ? (
            // Show all labels for 7 days or less
            data.map((item) => (
              <span key={item.date} style={{ flex: 1, textAlign: "center" }}>
                {formatDate(item.date)}
              </span>
            ))
          ) : (
            // Show first, middle, and last for more than 7 days
            <>
              <span>{formatDate(data[0].date)}</span>
              <span>{formatDate(data[Math.floor(data.length / 2)].date)}</span>
              <span>{formatDate(data[data.length - 1].date)}</span>
            </>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 16,
          marginTop: 16,
          padding: 16,
          backgroundColor: "#f9fafb",
          borderRadius: 6,
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Total</p>
          <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600 }}>
            {formatCurrency(data.reduce((sum, d) => sum + d.revenue, 0))}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Average</p>
          <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600 }}>
            {formatCurrency(data.reduce((sum, d) => sum + d.revenue, 0) / data.length)}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Peak Day</p>
          <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600 }}>
            {formatCurrency(maxRevenue)}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Days with Sales</p>
          <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600 }}>
            {data.filter((d) => d.revenue > 0).length} / {data.length}
          </p>
        </div>
      </div>
    </div>
  );
}
