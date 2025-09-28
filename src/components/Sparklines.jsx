// src/components/Sparklines.jsx
import React from "react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";

export function Sparkline({ data = [], dataKey = "y", height = 40 }) {
  // Expect [{x, y}...]
  if (!data || data.length === 0) {
    return <div className="h-10 flex items-center text-xs text-slate-400">—</div>;
  }
  return (
    <div className="h-10">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
          <Area type="monotone" dataKey={dataKey} strokeOpacity={0.9} fillOpacity={0.15} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SparklineRow({ title, A = [], B = [], fmt=(v)=>v.toFixed?.(2) ?? v }) {
  const lastA = A?.length ? A[A.length-1].y : null;
  const lastB = B?.length ? B[B.length-1].y : null;
  return (
    <div className="grid grid-cols-5 gap-3 items-center">
      <div className="col-span-1 text-xs text-slate-600">{title}</div>
      <div className="col-span-2 rounded-lg border bg-white/60 px-2">
        <Sparkline data={A} />
      </div>
      <div className="col-span-2 rounded-lg border bg-white/60 px-2">
        <Sparkline data={B} />
      </div>
      {(lastA != null || lastB != null) && (
        <div className="col-span-5 -mt-1 text-[10px] text-slate-500">
          Latest: A {lastA != null ? fmt(lastA) : "—"} · B {lastB != null ? fmt(lastB) : "—"}
        </div>
      )}
    </div>
  );
}
