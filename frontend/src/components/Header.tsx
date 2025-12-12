type Props = {
  totalProducts: number;
  selectedName?: string | null;
};

export default function Header({ totalProducts, selectedName }: Props) {
  return (
    <header
      style={{
        background:
          "linear-gradient(120deg, rgba(31,122,255,0.12), rgba(130,70,255,0.14)), #0b1021",
        color: "#fff",
        padding: "22px 18px",
        borderRadius: "14px",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 18px 40px rgba(12, 19, 42, 0.45)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ margin: 0, opacity: 0.7 }}>Gel Invent</p>
          <h1 style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 700 }}>
            Inventory cockpit
          </h1>
        </div>
        <div className="badge">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
          <span>{totalProducts} products</span>
          {selectedName ? <span style={{ opacity: 0.7 }}>• {selectedName}</span> : null}
        </div>
      </div>
    </header>
  );
}
