type LocationStock = {
  location: string;
  products: number;
  total_units: number;
  value: number;
};

type Props = {
  locations: LocationStock[];
};

export default function LocationBreakdown({ locations }: Props) {
  const formatCurrency = (value: number) => {
    return `GHS ${value.toFixed(2)}`;
  };

  const totalValue = locations.reduce((sum, loc) => sum + loc.value, 0);
  const totalUnits = locations.reduce((sum, loc) => sum + loc.total_units, 0);

  const getLocationIcon = (_location: string) => {
    return "";
  };

  const getLocationColor = (index: number) => {
    const colors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4"];
    return colors[index % colors.length];
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 18, fontWeight: 600 }}>
          Stock by Location
        </h3>
        <div style={{ display: "flex", gap: 24, fontSize: 14, color: "#6b7280" }}>
          <div>
            Total Locations: <span style={{ fontWeight: 600, color: "#111827" }}>{locations.length}</span>
          </div>
          <div>
            Total Units: <span style={{ fontWeight: 600, color: "#111827" }}>{totalUnits.toFixed(2)}</span>
          </div>
          <div>
            Total Value: <span style={{ fontWeight: 600, color: "#111827" }}>{formatCurrency(totalValue)}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {locations.map((loc, index) => {
          const valuePercentage = totalValue > 0 ? (loc.value / totalValue) * 100 : 0;
          const color = getLocationColor(index);

          return (
            <div
              key={loc.location}
              style={{
                backgroundColor: "white",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                padding: 20,
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Background gradient */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 4,
                  backgroundColor: color,
                }}
              />

              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 32,
                    lineHeight: 1,
                  }}
                >
                  {getLocationIcon(loc.location)}
                </div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{loc.location}</h4>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
                    {loc.products} product{loc.products !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Total Units</p>
                  <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700 }}>
                    {loc.total_units.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Stock Value</p>
                  <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700, color }}>
                    {formatCurrency(loc.value)}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>% of Total Value</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <div
                      style={{
                        flex: 1,
                        height: 8,
                        backgroundColor: "#e5e7eb",
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${valuePercentage}%`,
                          backgroundColor: color,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {valuePercentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {locations.length === 0 && (
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 48,
            textAlign: "center",
            color: "#6b7280",
          }}
        >
          No location data available
        </div>
      )}
    </div>
  );
}
