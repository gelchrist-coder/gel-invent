import type { CSSProperties } from "react";

type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
};

/** A single shimmering placeholder block. */
export function Skeleton({ width = "100%", height = 16, radius = 8, style }: SkeletonProps) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** A card-shaped skeleton matching the app's `.card` blocks. */
export function SkeletonCard({ lines = 3, style }: { lines?: number; style?: CSSProperties }) {
  return (
    <div className="card" style={{ display: "grid", gap: 10, ...style }}>
      <Skeleton width="55%" height={12} />
      <Skeleton width="40%" height={26} />
      {Array.from({ length: Math.max(0, lines - 2) }).map((_, index) => (
        <Skeleton key={index} width={`${85 - index * 12}%`} height={12} />
      ))}
    </div>
  );
}

/** Row of KPI-style skeleton cards. */
export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="card" style={{ padding: "14px 16px", display: "grid", gap: 8 }}>
          <Skeleton width="60%" height={11} />
          <Skeleton width="45%" height={24} />
          <Skeleton width="70%" height={11} />
        </div>
      ))}
    </div>
  );
}

/** Full-page skeleton used while a lazy view's code/data is loading. */
export function PageSkeleton() {
  return (
    <div className="app-shell" aria-busy="true">
      <Skeleton width={220} height={28} style={{ marginBottom: 16 }} />
      <SkeletonKpiRow />
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}
      >
        <SkeletonCard lines={6} style={{ minHeight: 220 }} />
        <SkeletonCard lines={6} style={{ minHeight: 220 }} />
      </div>
    </div>
  );
}
