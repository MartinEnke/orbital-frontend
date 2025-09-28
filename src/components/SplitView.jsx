// src/components/SplitView.jsx
import React from "react";
import Scene3D from "../Scene3D.jsx"; // we’ll export Scene3D from a separate file (see edits below)

export default function SplitView({
  framesA, framesB, frameIdx, showTrail, showThrust, planets, tDays,
  showAgent, showLabels, planetColors, eccScale, thrustScale
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden shadow-2xl" style={{ height: "70vh" }}>
        <div className="px-3 py-2 text-xs text-slate-300 bg-white/5 border-b border-white/10">A · Random</div>
        <Scene3D
          frames={framesA}
          frameIdx={frameIdx}
          showTrail={showTrail}
          showThrust={showThrust}
          planets={planets}
          tDays={tDays}
          showAgent={showAgent}
          showLabels={showLabels}
          planetColors={planetColors}
          eccScale={eccScale}
          thrustScale={thrustScale}
        />
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden shadow-2xl" style={{ height: "70vh" }}>
        <div className="px-3 py-2 text-xs text-slate-300 bg-white/5 border-b border-white/10">B · PPO</div>
        <Scene3D
          frames={framesB}
          frameIdx={frameIdx}
          showTrail={showTrail}
          showThrust={showThrust}
          planets={planets}
          tDays={tDays}
          showAgent={showAgent}
          showLabels={showLabels}
          planetColors={planetColors}
          eccScale={eccScale}
          thrustScale={thrustScale}
        />
      </div>
    </div>
  );
}
