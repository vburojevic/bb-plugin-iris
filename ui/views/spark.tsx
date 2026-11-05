import { useId } from "react";

/** A tiny line, optionally filled, scaled to its box. */
export function SparkPath({ values, color, width = 96, height = 24, area = true, className }: { values: number[]; color: string; width?: number; height?: number; area?: boolean; className?: string }) {
  const id = useId();
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, k) => [(k / (values.length - 1)) * (width - 2) + 1, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      {area ? (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.12" />
              <stop offset="1" stopColor={color} stopOpacity="0.12" />
            </linearGradient>
          </defs>
          <path d={`${line} L${pts[pts.length - 1][0]} ${height} L${pts[0][0]} ${height} Z`} fill={`url(#${CSS.escape(id)})`} />
        </>
      ) : null}
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2" fill={color} />
    </svg>
  );
}
