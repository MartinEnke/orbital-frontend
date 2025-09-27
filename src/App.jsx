// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Html, GizmoHelper, GizmoViewport, StatsGl } from "@react-three/drei";

import MissionModal from "./components/MissionModal.jsx";
import ExplainPanel from "./components/ExplainPanel.jsx";

/**
 * Orbital RL + Solar System Frontend (A/B + LLM)
 * - Keplerian planets (colored), labels (toggleable)
 * - Agent rollout viewer with trail + thrust vector
 * - A/B toggle between two rollouts (press “B”)
 * - Timeline with event markers, ComparePanel with quick stats
 * - Mission creator (manual or LLM-suggested) + ExplainPanel (LLM)
 */

/* ---------------- Utils ---------------- */
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const vecLen = (v) => Math.hypot(v[0], v[1], v[2]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function orbitalElements(r, v, mu = 1.0) {
  const rmag = vecLen(r);
  const vmag = vecLen(v);
  const h = cross(r, v);
  const hmag = vecLen(h);
  const energy = 0.5 * vmag * vmag - mu / rmag;
  const a = -mu / (2 * energy);
  const vxh = cross(v, h);
  const evec = [vxh[0]/mu - r[0]/rmag, vxh[1]/mu - r[1]/rmag, vxh[2]/mu - r[2]/rmag];
  const e = vecLen(evec);
  return { a, e, hmag, energy };
}

/* -------------- Data loaders -------------- */
async function loadRollout(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch rollout: ${res.status}`);
  const json = await res.json();
  return json.episodes || [];
}
async function loadPlanets(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("no planets.json");
    const json = await res.json();
    return json.planets || [];
  } catch {
    return [
      { name: "Mercury", a: 0.3871, e: 0.2056, i: 7.005,  Omega: 48.331,  omega: 29.124,  M0: 174.796 },
      { name: "Venus",   a: 0.7233, e: 0.0068, i: 3.395,  Omega: 76.680,  omega: 54.884,  M0: 50.416  },
      { name: "Earth",   a: 1.0000, e: 0.0167, i: 0.000,  Omega: -11.260, omega: 102.947, M0: 100.464 },
      { name: "Mars",    a: 1.5237, e: 0.0934, i: 1.850,  Omega: 49.558,  omega: 286.503, M0: 355.453 },
      { name: "Jupiter", a: 5.2026, e: 0.0489, i: 1.303,  Omega: 100.464, omega: 273.867, M0: 20.020  },
      { name: "Saturn",  a: 9.5549, e: 0.0565, i: 2.485,  Omega: 113.665, omega: 339.392, M0: 317.020 }
    ];
  }
}

/* -------------- Kepler helpers -------------- */
function keplerE(M, e) { let E = M; for (let k=0;k<8;k++){ const f=E-e*Math.sin(E)-M; const fp=1-e*Math.cos(E); E-=f/fp;} return E; }
function elementsToPositionAU({ a, e, i, Omega, omega, M }) {
  const E = keplerE(M, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const nu = Math.atan2(Math.sqrt(1 - e*e) * sinE, cosE - e);
  const r_orb = a * (1 - e * cosE);
  const x_orb = r_orb * Math.cos(nu), y_orb = r_orb * Math.sin(nu);
  const cosO = Math.cos(Omega), sinO = Math.sin(Omega);
  const cosi = Math.cos(i),     sini = Math.sin(i);
  const cosw = Math.cos(omega), sinw = Math.sin(omega);
  const X1 = cosw * x_orb - sinw * y_orb;
  const Y1 = sinw * x_orb + cosw * y_orb;
  const X2 = X1;
  const Y2 = cosi * Y1;
  const Z2 = sini * Y1;
  const x = cosO * X2 - sinO * Y2;
  const y = sinO * X2 + cosO * Y2;
  const z = Z2;
  return [x, y, z];
}

/* -------------- Station-keeping errors (HUD) -------------- */
function stationKeepingErrors(frame, R0 = 1.0) {
  if (!frame) return null;
  const r = frame.r, v = frame.v;
  const rmag = Math.hypot(r[0], r[1], r[2]);
  const r_hat = [r[0]/(rmag+1e-9), r[1]/(rmag+1e-9), r[2]/(rmag+1e-9)];
  const v_rad = v[0]*r_hat[0] + v[1]*r_hat[1] + v[2]*r_hat[2];
  const vmag = Math.hypot(v[0], v[1], v[2]);
  const v_tan = Math.sqrt(Math.max(0, vmag*vmag - v_rad*v_rad));
  const mu = 1.0;
  const v_circ = Math.sqrt(mu / Math.max(1e-9, R0));
  return { rmag, pos_err: rmag - R0, v_rad, v_tan, v_tan_err: v_tan - v_circ, v_circ };
}

/* -------------- Small Rollout Hook (A/B) -------------- */
function useRollout(url, tolR = 0.05, tolV = 0.05, thrustSpike = 0.02) {
  const [episodes, setEpisodes] = useState([]);
  const [metrics, setMetrics] = useState([]); // per-episode summary + events
  useEffect(() => {
    let cancelled = false;
    async function go() {
      try {
        const eps = await loadRollout(url);
        if (cancelled) return;
        setEpisodes(eps);
        // compute quick metrics/events
        const mets = eps.map((frames) => {
          let rewardSum = 0;
          let fuelSum = 0;
          let capturedAt = null;
          const events = [];
          frames.forEach((f, idx) => {
            rewardSum += (f.reward ?? 0);
            const thr = f.thrust ? Math.hypot(...f.thrust) : 0;
            fuelSum += thr;
            if (thr > thrustSpike) events.push({ t: idx, type: "thrust" });
            const posErr = f.pos_err ?? (Math.hypot(...f.r) - 1.0);
            const vtanErr = (f.v_tan_err ?? 0);
            if (posErr <= tolR && Math.abs(vtanErr) <= tolV) {
              if (capturedAt == null) {
                capturedAt = idx;
                events.push({ t: idx, type: "entered_tol" });
              }
            }
          });
          return {
            rewardSum, fuelSum, capturedAt, events,
            len: frames.length
          };
        });
        if (!cancelled) setMetrics(mets);
      } catch (e) {
        console.error("loadRollout failed", e);
        setEpisodes([]);
        setMetrics([]);
      }
    }
    go();
    return () => { cancelled = true; };
  }, [url, tolR, tolV, thrustSpike]);
  return { episodes, metrics };
}

/* -------------- R3F Scene -------------- */
function Satellite({ frame }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current && frame) {
      const p = frame.r; ref.current.position.set(p[0], p[1], p[2]);
    }
  }, [frame]);
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.03, 16, 16]} />
      <meshStandardMaterial color="#e5e7eb" metalness={0.3} roughness={0.5} />
    </mesh>
  );
}
function ThrustVector({ frame, baseScale = 2.0, thrustScale = 50 }) {
  if (!frame?.r || !frame?.thrust) return null;
  const p = frame.r, u = frame.thrust;
  const mag = Math.hypot(u[0], u[1], u[2]);
  if (mag < 1e-8) return null;
  const s = baseScale * thrustScale;
  const end = [p[0] + u[0] * s, p[1] + u[1] * s, p[2] + u[2] * s];
  return <Line points={[p, end]} lineWidth={2} color="#38bdf8" />;
}
function Trail({ frames, every = 2, maxPoints = 2000 }) {
  const points = useMemo(() => {
    const pts = [];
    for (let i = 0; i < frames.length; i += every) { pts.push(frames[i].r); if (pts.length >= maxPoints) break; }
    return pts;
  }, [frames, every, maxPoints]);
  if (points.length < 2) return null;
  return <Line points={points} lineWidth={1} color="#22d3ee" />;
}
function Axes() {
  return (
    <group>
      <Line points={[[0,0,0],[1.5,0,0]]} lineWidth={1} color="#fb7185" />
      <Line points={[[0,0,0],[0,1.5,0]]} lineWidth={1} color="#34d399" />
      <Line points={[[0,0,0],[0,0,1.5]]} lineWidth={1} color="#60a5fa" />
    </group>
  );
}
function Planets({ planets, tDays, scaleAU = 1.5, planetColors, showLabels, eccScale = 1 }) {
  const mu = 0.0002959122082855911; // AU^3/day^2
  const rad = Math.PI / 180;
  return (
    <group>
      {planets.map((p) => {
        const eVis = Math.min(p.e * eccScale, 0.9);
        const n = Math.sqrt(mu / Math.pow(p.a, 3));
        const M = (p.M0 * rad + n * tDays) % (2 * Math.PI);
        const rAU = elementsToPositionAU({ a: p.a, e: eVis, i: p.i*rad, Omega: p.Omega*rad, omega: p.omega*rad, M });
        const r = rAU.map((v) => v * scaleAU);
        const path = [...Array(360)].map((_, k) => {
          const th = (2 * Math.PI * k) / 360;
          const rtmp = elementsToPositionAU({ a: p.a, e: eVis, i: p.i*rad, Omega: p.Omega*rad, omega: p.omega*rad, M: th });
          return rtmp.map((v) => v * scaleAU);
        });
        const color = planetColors?.[p.name] || "#9ca3af";
        const radius = 0.022 + 0.02 * Math.log10(1 + p.a);
        return (
          <group key={p.name}>
            <Line points={path} lineWidth={0.35} color={color} />
            <mesh position={r}>
              <sphereGeometry args={[radius, 24, 24]} />
              <meshStandardMaterial color={color} metalness={0.2} roughness={0.4} />
            </mesh>
            {showLabels && (
              <Html position={r} distanceFactor={28} style={{ pointerEvents: "none" }}>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
                    color: "#f8fafc",
                    background: "linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0.2))",
                    padding: "2px 6px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.15)",
                    textShadow: "0 1px 1px rgba(0,0,0,0.6)"
                  }}
                >
                  {p.name}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
function Scene3D({
  frames, frameIdx, showTrail, showThrust, planets, tDays, showAgent, showLabels, planetColors, eccScale, thrustScale
}) {
  const frame = frames[clamp(frameIdx, 0, frames.length - 1)] || null;
  return (
    <Canvas camera={{ position: [2.8, 2.2, 2.8], fov: 45 }} style={{ width: "100%", height: "100%" }}>
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 0, 0]} intensity={1.6} color="#fff8e1" />
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.1, 48, 48]} />
        <meshStandardMaterial color="#ffd166" emissive="#ffb703" emissiveIntensity={1.5} roughness={0.25} metalness={0.1} />
      </mesh>
      {planets?.length > 0 && (
        <Planets planets={planets} tDays={tDays} scaleAU={1.5} planetColors={planetColors} showLabels={showLabels} eccScale={eccScale} />
      )}
      {showAgent && showTrail && <Trail frames={frames} />}
      {showAgent && frame && <Satellite frame={frame} />}
      {showAgent && showThrust && frame && <ThrustVector frame={frame} thrustScale={thrustScale} />}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
      <OrbitControls enableDamping makeDefault />
      <StatsGl className="hidden md:block" />
    </Canvas>
  );
}

/* -------------- Timeline with markers -------------- */
function Timeline({ max, value, onChange, events = [] }) {
  const pct = (t) => (max > 0 ? (t / max) * 100 : 0);
  return (
    <div className="w-full">
      <div className="relative h-6">
        {/* markers */}
        {events.map((ev, i) => (
          <button
            key={i}
            title={ev.type}
            onClick={() => onChange(ev.t)}
            className={`absolute top-1 h-4 w-1 ${ev.type === "thrust" ? "bg-sky-400" : "bg-emerald-400"}`}
            style={{ left: `calc(${pct(ev.t)}% - 1px)` }}
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, max)}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <div className="text-xs text-gray-400 mt-1">Frame {value}/{max}</div>
    </div>
  );
}

/* -------------- Compare panel (quick stats) -------------- */
function ComparePanel({ mA, mB, frameIdx }) {
  return (
    <div className="rounded-2xl border bg-white/70 text-slate-900 p-4">
      <h3 className="font-semibold mb-2">Compare (A vs B)</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-gray-500">Total reward</div>
          <div>{mA ? mA.rewardSum.toFixed(2) : "—"} vs {mB ? mB.rewardSum.toFixed(2) : "—"}</div>
        </div>
        <div>
          <div className="text-gray-500">Total fuel (∑|u|)</div>
          <div>{mA ? mA.fuelSum.toFixed(3) : "—"} vs {mB ? mB.fuelSum.toFixed(3) : "—"}</div>
        </div>
        <div>
          <div className="text-gray-500">Captured at</div>
          <div>{mA?.capturedAt ?? "—"} vs {mB?.capturedAt ?? "—"}</div>
        </div>
        <div>
          <div className="text-gray-500">Frames</div>
          <div>{mA?.len ?? "—"} vs {mB?.len ?? "—"}</div>
        </div>
      </div>
      <div className="text-xs text-gray-500 mt-2">At frame {frameIdx}</div>
    </div>
  );
}

/* -------------- HUD -------------- */
function HUD({
  ab, setAb,
  episodes, activeEp, setActiveEp, playing, setPlaying, speed, setSpeed,
  frameIdx, setFrameIdx, frames,
  showTrail, setShowTrail, showThrust, setShowThrust,
  showAgent, setShowAgent,
  showLabels, setShowLabels,
  eccScale, setEccScale,
  thrustScale, setThrustScale,
  eventsA, eventsB,
}) {
  const frame = frames[clamp(frameIdx, 0, frames.length - 1)];
  const elements = useMemo(() => (frame ? orbitalElements(frame.r, frame.v, 1.0) : null), [frame]);

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
      <div className="p-4 rounded-2xl bg-white/70 backdrop-blur border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Playback</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Rollout</span>
            <div className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-900 text-white">{ab}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPlaying(!playing)} className="px-3 py-1 rounded-xl border">{playing ? "Pause" : "Play"}</button>
          <label className="text-sm">Speed</label>
          <input type="range" min="0.1" max="5" step="0.1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-40" />
          <span className="text-sm w-10 text-center">{speed.toFixed(1)}x</span>
          <button onClick={() => setAb((p) => (p === "A" ? "B" : "A"))} className="ml-auto px-3 py-1 rounded-xl border" title="Hotkey: B">
            Toggle A/B
          </button>
        </div>
        <div className="mt-3">
          <Timeline
            max={Math.max(0, frames.length - 1)}
            value={frameIdx}
            onChange={setFrameIdx}
            events={ab === "A" ? (eventsA || []) : (eventsB || [])}
          />
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showAgent} onChange={(e) => setShowAgent(e.target.checked)} /> Show agent
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} /> Show trail
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showThrust} onChange={(e) => setShowThrust(e.target.checked)} /> Thrust
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Planet labels
          </label>
        </div>

        {/* Visual scales */}
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap">Eccentricity scale</span>
            <input type="range" min="1" max="4" step="0.1" value={eccScale} onChange={(e) => setEccScale(Number(e.target.value))} className="w-40" />
            <span className="w-12 text-right">{eccScale.toFixed(1)}×</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap">Thrust arrow scale</span>
            <input type="range" min="1" max="200" step="1" value={thrustScale} onChange={(e) => setThrustScale(Number(e.target.value))} className="w-40" />
            <span className="w-12 text-right">{thrustScale}×</span>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-2xl bg-white/70 backdrop-blur border">
        <h2 className="text-lg font-semibold mb-2">Episode</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={activeEp} onChange={(e) => { const i = Number(e.target.value); setActiveEp(i); setFrameIdx(0); }} className="px-2 py-1 rounded-xl border">
            {episodes.map((ep, i) => (<option key={i} value={i}>Episode {i + 1} ({ep.length} frames)</option>))}
          </select>
          <button onClick={() => setFrameIdx(0)} className="px-3 py-1 rounded-xl border">Restart</button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-3">
          <div className="text-gray-600">a (semi-major)</div>
          <div>{elements ? elements.a.toFixed(3) : "—"}</div>
          <div className="text-gray-600">e (eccentricity)</div>
          <div>{elements ? elements.e.toFixed(3) : "—"}</div>
          <div className="text-gray-600">|H|</div>
          <div>{elements ? elements.hmag.toFixed(3) : "—"}</div>
          <div className="text-gray-600">Energy</div>
          <div>{elements ? elements.energy.toFixed(3) : "—"}</div>
        </div>
      </div>

      {/* Compare card slot will be filled from parent */}
      <div className="hidden lg:block" />
    </div>
  );
}

/* -------------- Main App -------------- */
export default function App({ planetsUrl = "/planets.json" }) {
  // A/B hotkey toggle
  const [ab, setAb] = useState("A");
  useEffect(() => {
    const onKey = (e) => { if (e.key.toLowerCase() === "b") setAb((p) => (p === "A" ? "B" : "A")); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Mission + LLM explain
  const [showMission, setShowMission] = useState(false);
  const [mission, setMission] = useState(null);

  // Visual toggles
  const [showTrail, setShowTrail] = useState(true);
  const [showThrust, setShowThrust] = useState(true);
  const [showAgent, setShowAgent] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [eccScale, setEccScale] = useState(1.0);
  const [thrustScale, setThrustScale] = useState(50);

  // Playback
  const [activeEp, setActiveEp] = useState(0);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1.0);

  // Solar system
  const [planets, setPlanets] = useState([]);
  const [tDays, setTDays] = useState(0);

  useEffect(() => { loadPlanets(planetsUrl).then(setPlanets).catch(console.error); }, [planetsUrl]);

  // Load two rollouts
  const { episodes: epsA, metrics: metsA } = useRollout("/rollouts/run_random.json");
  const { episodes: epsB, metrics: metsB } = useRollout("/rollouts/run_ppo.json");

  // Current set
  const eps = ab === "A" ? epsA : epsB;
  const frames = useMemo(() => eps[activeEp] || [], [eps, activeEp]);
  const frame = frames[Math.floor(frameIdx)] || null;
  const prevFrame = frames[Math.max(0, Math.floor(frameIdx) - 1)] || null;
  const eventsA = metsA?.[activeEp]?.events || [];
  const eventsB = metsB?.[activeEp]?.events || [];

  // Playback + solar time advance
  const lastTime = useRef(performance.now());
  useEffect(() => {
    let raf;
    function tick(now) {
      const dt = (now - lastTime.current) / 1000;
      lastTime.current = now;
      if (playing && frames.length > 0) {
        const increment = dt * 60 * speed;
        setFrameIdx((i) => Math.min(frames.length - 1, i + increment));
      }
      setTDays((d) => d + dt * 10 * speed);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, frames.length, speed]);

  // Colors
  const planetColors = useMemo(() => ({
    Mercury: "#a1a1aa", Venus: "#f59e0b", Earth: "#22c55e", Mars: "#ef4444",
    Jupiter: "#f97316", Saturn: "#fde68a", Uranus: "#7dd3fc", Neptune: "#60a5fa"
  }), []);

  const frameIdxInt = Math.floor(frameIdx);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-4 md:p-8">
      {/* Header */}
      <header className="max-w-6xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Orbital RL + Solar System</h1>
          <p className="text-slate-300 mt-1">Random vs PPO · press “B” to toggle</p>
        </div>
        <button onClick={() => setShowMission(true)} className="px-3 py-2 rounded-xl border bg-white/10 hover:bg-white/20">
          New Mission
        </button>
      </header>

      <main className="max-w-6xl mx-auto">
        {/* HUD */}
        <HUD
          ab={ab} setAb={setAb}
          episodes={eps} activeEp={activeEp} setActiveEp={setActiveEp}
          playing={playing} setPlaying={setPlaying}
          speed={speed} setSpeed={setSpeed}
          frameIdx={frameIdxInt} setFrameIdx={(i) => setFrameIdx(i)}
          frames={frames}
          showTrail={showTrail} setShowTrail={setShowTrail}
          showThrust={showThrust} setShowThrust={setShowThrust}
          showAgent={showAgent} setShowAgent={setShowAgent}
          showLabels={showLabels} setShowLabels={setShowLabels}
          eccScale={eccScale} setEccScale={setEccScale}
          thrustScale={thrustScale} setThrustScale={setThrustScale}
          eventsA={eventsA} eventsB={eventsB}
        />

        {/* Compare panel */}
        <div className="mt-4">
          <ComparePanel mA={metsA?.[activeEp]} mB={metsB?.[activeEp]} frameIdx={frameIdxInt} />
        </div>

        {/* Explain panel */}
        <div className="mt-4">
          <ExplainPanel frame={frame} prevFrame={prevFrame} mission={mission} />
        </div>

        {/* Big canvas */}
        <section className="mt-6 w-full">
          <div style={{ height: "88vh", width: "100%" }} className="mx-auto max-w-[1400px] w-full rounded-3xl border border-white/10 bg-white/5 overflow-hidden shadow-2xl">
            <Scene3D
              frames={frames}
              frameIdx={frameIdxInt}
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
        </section>
      </main>

      {/* Mission modal */}
      <MissionModal
        open={showMission}
        onClose={() => setShowMission(false)}
        onCreate={(m) => setMission(m)}
        defaultMission={mission}
      />
    </div>
  );
}
