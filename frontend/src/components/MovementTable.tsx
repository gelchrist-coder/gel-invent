import { StockMovement } from "../types";

function formatChange(n: number) {
  const sign = n > 0 ? "+" : "";
  const color = n >= 0 ? "#0f9d58" : "#d14343";
  return <span style={{ color, fontWeight: 700 }}>{`${sign}${n.toFixed(2)}`}</span>;
}

function formatExpiry(expiryDate: string | null) {
  if (!expiryDate) return null;
  
  const expiry = new Date(expiryDate);
  const today = new Date();
  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    return (
      <span style={{ 
        color: "#d14343", 
        fontSize: 12, 
        padding: "2px 6px", 
        background: "#fee", 
        borderRadius: 4,
        fontWeight: 600,
      }}>
        EXPIRED
      </span>
    );
  } else if (diffDays <= 30) {
    return (
      <span style={{ 
        color: "#f59e0b", 
        fontSize: 12, 
        padding: "2px 6px", 
        background: "#fef3e8", 
        borderRadius: 4,
        fontWeight: 600,
      }}>
        {diffDays}d left
      </span>
    );
  }
  
  return <span style={{ fontSize: 12, color: "#6b7280" }}>{expiry.toLocaleDateString()}</span>;
}

type Props = {
  movements: StockMovement[];
  balance: number;
};

export default function MovementTable({ movements, balance }: Props) {
  const showExpiryColumn = movements.some((m) => !!m.expiry_date);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="section-title">Movements</h2>
        <div className="badge">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f7aff" }} />
          Balance {balance.toFixed(2)}
        </div>
      </div>
      {movements.length === 0 ? (
        <p style={{ margin: 0, color: "#4a5368" }}>No movements yet for this product.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Change</th>
              <th>Reason</th>
              <th>Batch</th>
              {showExpiryColumn ? <th>Batch Expiry</th> : null}
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.created_at).toLocaleString()}</td>
                <td>{formatChange(m.change)}</td>
                <td>{m.reason}</td>
                <td>
                  {m.batch_number ? (
                    <span style={{ 
                      fontSize: 12, 
                      padding: "2px 6px", 
                      background: "#e6e9f2", 
                      borderRadius: 4,
                      fontFamily: "monospace",
                    }}>
                      {m.batch_number}
                    </span>
                  ) : (
                    <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>
                  )}
                </td>
                {showExpiryColumn ? (
                  <td>
                    {m.expiry_date ? (
                      formatExpiry(m.expiry_date)
                    ) : (
                      <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
