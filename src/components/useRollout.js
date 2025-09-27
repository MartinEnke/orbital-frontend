// src/components/useRollout.js
import { useEffect, useMemo, useState } from "react";

export function computeMetrics(frames, cfg={rTarget:1.0, thrustTau:0.01}) {
  const out = {
    reward: frames.map(f => f.reward ?? 0),
    fuel:   frames.map(f => (f.thrust ? Math.hypot(...f.thrust) : 0)),
    rmag:   frames.map(f => Math.hypot(...f.r)),
    v_rad:  [],
    v_tan_err: [],
    events: [],
  };
  const vCirc = Math.sqrt(1.0 / cfg.rTarget);
  for (let i=0;i<frames.length;i++){
    const r = frames[i].r, v = frames[i].v;
    const rmag = out.rmag[i];
    const rhat = rmag>1e-9 ? [r[0]/rmag, r[1]/rmag, r[2]/rmag] : [0,0,0];
    const v_rad = v[0]*rhat[0]+v[1]*rhat[1]+v[2]*rhat[2];
    const vmag = Math.hypot(...v);
    const v_tan = Math.sqrt(Math.max(0, vmag*vmag - v_rad*v_rad));
    out.v_rad.push(v_rad);
    out.v_tan_err.push(v_tan - vCirc);

    const fuel = out.fuel[i];
    if (fuel > cfg.thrustTau) out.events.push({type:"thrust", i, fuel});
    if (Math.abs(rmag - cfg.rTarget) < 0.05 && Math.abs(v_tan - vCirc) < 0.05 && Math.abs(v_rad)<0.02)
      out.events.push({type:"in_tol", i});
    if (rmag < 0.2) out.events.push({type:"too_close", i});
    if (rmag > 5.0) out.events.push({type:"escape", i});
  }
  // capture time
  const firstTol = out.events.find(e=>e.type==="in_tol")?.i ?? null;
  return { ...out, firstTol };
}

export function useRollout(url) {
  const [episodes, setEpisodes] = useState([]);
  const [metrics, setMetrics]   = useState([]);
  useEffect(()=>{
    let alive=true;
    (async()=>{
      const res = await fetch(url); if(!res.ok) return;
      const json = await res.json();
      const eps  = json.episodes || [];
      const mets = eps.map(ep => computeMetrics(ep));
      if (alive){ setEpisodes(eps); setMetrics(mets); }
    })();
    return ()=>{ alive=false; };
  },[url]);
  return { episodes, metrics };
}
