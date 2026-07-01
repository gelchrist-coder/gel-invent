import { useRef, useState } from "react";

import { compressImageToDataUrl } from "../image";

type Props = {
  value?: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
};

const PlaceholderIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

// Reusable product-photo picker: compresses to a small square thumbnail so it
// stays light enough to store and show on the POS.
export default function ImagePicker({ value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    if (file.type && !file.type.startsWith("image/")) {
      setError("Please choose an image (PNG or JPG).");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await compressImageToDataUrl(file, { maxSize: 240, mime: "image/jpeg", quality: 0.72 });
      onChange(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the image.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          background: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {value ? (
          <img src={value} alt="Product" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <PlaceholderIcon />
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: disabled || busy ? "not-allowed" : "pointer",
              color: "#334155",
            }}
          >
            {busy ? "Processing…" : value ? "Change photo" : "Upload photo"}
          </button>
          {value && !busy && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(null)}
              style={{
                padding: "7px 12px",
                borderRadius: 8,
                border: "1px solid #fecaca",
                background: "#fff5f5",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                color: "#b91c1c",
              }}
            >
              Remove
            </button>
          )}
        </div>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>Shown on the POS. A square photo works best.</span>
        {error && <span style={{ fontSize: 12, color: "#b91c1c" }}>{error}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
