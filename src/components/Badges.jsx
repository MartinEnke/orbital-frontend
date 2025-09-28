// src/components/Badges.jsx
import React from "react";

export default function Badges({ m }) {
  const captured = m?.capturedAt != null;
  return (
    <div className="flex flex-wrap gap-2">
      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border ${captured ? "bg-emerald-50/60 text-emerald-700 border-emerald-200" : "bg-rose-50/60 text-rose-700 border-rose-200"}`}>
        {captured ? "Captured ✅" : "Not captured ❌"}
      </span>
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border bg-sky-50/60 text-sky-700 border-sky-200">
        Time-to-capture: {captured ? m.capturedAt : "—"}
      </span>
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border bg-violet-50/60 text-violet-700 border-violet-200">
        % in tolerance: {m?.pctInTol != null ? (m.pctInTol*100).toFixed(1) + "%" : "—"}
      </span>
    </div>
  );
}
