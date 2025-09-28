// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import MissionModal from "./components/MissionModal.jsx";
import ExplainPanel from "./components/ExplainPanel.jsx";
import Scene3D from "./Scene3D.jsx";
import { SparklineRow } from "./components/Sparklines.jsx";
import Badges from "./components/Badges.jsx";

/** ---------------- Utils ---------------- */
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

/** -------------- Data loaders -------------- */
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

/** -------------- Station-keeping quick metrics -------------- */
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

/** -------------- Rollout hook (A/B) with robust capture -------------- */
function useRollout(url, tolR = 0.05, tolV = 0.05, thrustSpike = 0.02) {
  const [episodes, setEpisodes] = useState([]);
  const [metrics, setMetrics] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const eps = await loadRollout(url);
        if (cancelled) return;
        setEpisodes(eps);

        const mets = eps.map((frames) => {
          let rewardSum = 0;
          let fuelSum = 0;
          let capturedAt = null;
          let inTolCount = 0;
          const events = [];
          const spark = { reward: [], fuel: [], posErr: [], vTanErr: [] };

          const K = 30; // consecutive frames to declare capture
          let tolStreak = 0;
          let seenOut = false;

          frames.forEach((f, idx) => {
            const thr = f.thrust ? Math.hypot(...f.thrust) : 0;
            const posErr = f.pos_err ?? (Math.hypot(...f.r) - 1.0);
            const vtanErr = f.v_tan_err ?? (() => {
              const er = stationKeepingErrors(f, 1.0);
              return er?.v_tan_err ?? 0;
            })();

            rewardSum += (f.reward ?? 0);
            fuelSum += thr;
            if (thr > thrustSpike) events.push({ t: idx, type: "thrust" });

            const inTol = posErr <= tolR && Math.abs(vtanErr) <= tolV;
            if (inTol) {
              inTolCount++;
              tolStreak++;
              if (seenOut && capturedAt == null && tolStreak >= K) {
                capturedAt = idx - K + 1;
                events.push({ t: capturedAt, type: "entered_tol" });
              }
            } else {
              tolStreak = 0;
              seenOut = true;
            }

            spark.reward.push({ x: idx, y: f.reward ?? 0 });
            spark.fuel.push({ x: idx, y: thr });
            spark.posErr.push({ x: idx, y: posErr });
            spark.vTanErr.push({ x: idx, y: vtanErr });
          });

          const len = frames.length;
          const pctInTol = len > 0 ? inTolCount / len : 0;

          return { rewardSum, fuelSum, capturedAt, events, len, pctInTol, spark };
        });

        if (!cancelled) setMetrics(mets);
      } catch (e) {
        console.error("loadRollout failed", e);
        setEpisodes([]);
        setMetrics([]);
      }
    })();
    return () => { cancelled = true; };
  }, [url, tolR, tolV, thrustSpike]);

  return { episodes, metrics };
}

/** -------------- Timeline w/ markers -------------- */
function Timeline({ max, value, onChange, events = [] }) {
  const pct = (t) => (max > 0 ? (t / max) * 100 : 0);
  return (
    <div className="w-full">
      <div className="relative h-6">
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
      <div className="text-xs text-slate-400 mt-1">Frame {value}/{max}</div>
    </div>
  );
}

/** ======= HEADER ======= */
function Header({ split, setSplit, setShowMission }) {
  return (
    <header className="w-full border-b border-white/10 bg-white/5 backdrop-blur sticky top-0 z-20">
      <div className="container py-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orbital RL + Solar System</h1>
          <p className="text-slate-300 mt-0.5 text-xs md:text-sm">
            Random (A) vs PPO (B) · Hotkeys: <kbd>b</kbd> A/B, <kbd>s</kbd> split, <kbd>space</kbd> play/pause, <kbd>←/→</kbd> step, <kbd>k</kbd> explain
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSplit((p)=>!p)} className="btn">{split ? "Single View" : "Split View"}</button>
          <button onClick={() => setShowMission(true)} className="btn">New Mission</button>
        </div>
      </div>
    </header>
  );
}

/** ======= BOX 1: Playback ======= */
function PlaybackCard({
  ab, setAb, split,
  playing, setPlaying, speed, setSpeed,
  frameIdx, setFrameIdx, frames, eventsA,
  showAgent, setShowAgent, showTrail, setShowTrail, showThrust, setShowThrust, showLabels, setShowLabels,
  eccScale, setEccScale, thrustScale, setThrustScale
}) {
  return (
    <div className="card h-full">
      <h2 className="section-title">Playback</h2>
      <div className="text-[11px] text-slate-300 mb-2">
        Mode: <span className="font-semibold">{split ? "Split (A|B)" : (ab === "A" ? "Random (A)" : "PPO (B)")}</span> {!split && <span>— press <kbd>b</kbd></span>}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setPlaying(!playing)} className="btn">{playing ? "Pause" : "Play"}</button>
        <label className="text-sm">Speed</label>
        <input type="range" min="0.1" max="5" step="0.1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-32" />
        <span className="text-sm w-10 text-center">{speed.toFixed(1)}x</span>
        {!split && (
          <button onClick={() => setAb((p) => (p === "A" ? "B" : "A"))} className="btn ml-auto" title="Toggle A/B">Toggle A/B</button>
        )}
      </div>

      <div className="mt-3">
        <Timeline
          max={Math.max(0, frames.length - 1)}
          value={frameIdx}
          onChange={setFrameIdx}
          events={eventsA || []}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
        <label className="check"><input type="checkbox" checked={showAgent} onChange={(e) => setShowAgent(e.target.checked)} /> Show agent</label>
        <label className="check"><input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} /> Show trail</label>
        <label className="check"><input type="checkbox" checked={showThrust} onChange={(e) => setShowThrust(e.target.checked)} /> Thrust</label>
        <label className="check"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Planet labels</label>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap">Eccentricity scale</span>
          <input type="range" min="1" max="4" step="0.1" value={Number.isFinite(eccScale)?eccScale:1} onChange={(e) => setEccScale(Number(e.target.value))} className="w-32" />
          <span className="w-12 text-right">{Number.isFinite(eccScale)?eccScale.toFixed(1):"1.0"}×</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap">Thrust arrow scale</span>
          <input type="range" min="1" max="200" step="1" value={thrustScale} onChange={(e) => setThrustScale(Number(e.target.value))} className="w-32" />
          <span className="w-12 text-right">{thrustScale}×</span>
        </div>
      </div>
    </div>
  );
}

/** ======= BOX 2: Episode ======= */
function EpisodeCard({ episodes, activeEp, setActiveEp, elements }) {
  return (
    <div className="card h-full">
      <h2 className="section-title">Episode</h2>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <select
          value={activeEp}
          onChange={(e) => { const i = Number(e.target.value); setActiveEp(i); }}
          className="sel"
        >
          {episodes.map((ep, i) => (
            <option key={i} value={i}>Episode {i + 1} ({ep.length} frames)</option>
          ))}
        </select>
        <button onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })} className="btn">
          Jump to Canvas
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="label">a (semi-major)</div><div className="value">{elements ? elements.a.toFixed(3) : "—"}</div>
        <div className="label">e (eccentricity)</div><div className="value">{elements ? elements.e.toFixed(3) : "—"}</div>
        <div className="label">|H| (ang. mom)</div><div className="value">{elements ? elements.hmag.toFixed(3) : "—"}</div>
        <div className="label">Energy</div><div className="value">{elements ? elements.energy.toFixed(3) : "—"}</div>
      </div>
    </div>
  );
}

/** ======= BOX 3: Quick Status ======= */
function QuickStatus({ mA, mB }) {
  return (
    <div className="card h-full">
      <h3 className="section-title">Quick Status</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="mini-card">
          <div className="label">A — Captured</div>
          <div className="value">{mA?.capturedAt != null ? "✅" : "❌"}</div>
        </div>
        <div className="mini-card">
          <div className="label">B — Captured</div>
          <div className="value">{mB?.capturedAt != null ? "✅" : "❌"}</div>
        </div>
        <div className="mini-card">
          <div className="label">A — % in tol</div>
          <div className="value">{mA?.pctInTol != null ? (mA.pctInTol*100).toFixed(1)+"%" : "—"}</div>
        </div>
        <div className="mini-card">
          <div className="label">B — % in tol</div>
          <div className="value">{mB?.pctInTol != null ? (mB.pctInTol*100).toFixed(1)+"%" : "—"}</div>
        </div>
      </div>
    </div>
  );
}

/** ======= BOX 4: Episode Snapshot ======= */
function EpisodeSnapshot({ mA, mB }) {
  return (
    <div className="card h-full">
      <h3 className="section-title">Episode Snapshot</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="mini-card">
          <div className="label">A reward</div>
          <div className="value">{mA?.rewardSum?.toFixed?.(2) ?? "—"}</div>
        </div>
        <div className="mini-card">
          <div className="label">B reward</div>
          <div className="value">{mB?.rewardSum?.toFixed?.(2) ?? "—"}</div>
        </div>
        <div className="mini-card">
          <div className="label">A fuel</div>
          <div className="value">{mA?.fuelSum?.toFixed?.(3) ?? "—"}</div>
        </div>
        <div className="mini-card">
          <div className="label">B fuel</div>
          <div className="value">{mB?.fuelSum?.toFixed?.(3) ?? "—"}</div>
        </div>
      </div>
      <div className="footnote">Select episodes and play to update live.</div>
    </div>
  );
}

/** ======= ANALYTICS: A vs B side-by-side *inside* the box ======= */
function ComparePanel({ mA, mB, frameIdx }) {
  return (
    <div className="card">
      <h3 className="section-title">Episode Analytics — A vs B</h3>

      {/* Inline A | B columns in the same box */}
      <div className="mini-card">
        <div className="grid grid-cols-3 gap-2 items-center">
          <div className="label">Total reward</div>
          <div className="value text-right">A&nbsp;{mA ? mA.rewardSum.toFixed(2) : "—"}</div>
          <div className="value">B&nbsp;{mB ? mB.rewardSum.toFixed(2) : "—"}</div>
        </div>
      </div>
      <div className="mini-card mt-2">
        <div className="grid grid-cols-3 gap-2 items-center">
          <div className="label">Total fuel (∑|u|)</div>
          <div className="value text-right">A&nbsp;{mA ? mA.fuelSum.toFixed(3) : "—"}</div>
          <div className="value">B&nbsp;{mB ? mB.fuelSum.toFixed(3) : "—"}</div>
        </div>
      </div>
      <div className="mini-card mt-2">
        <div className="grid grid-cols-3 gap-2 items-center">
          <div className="label">Captured at</div>
          <div className="value text-right">A&nbsp;{mA?.capturedAt ?? "—"}</div>
          <div className="value">B&nbsp;{mB?.capturedAt ?? "—"}</div>
        </div>
      </div>
      <div className="mini-card mt-2">
        <div className="grid grid-cols-3 gap-2 items-center">
          <div className="label">Frames</div>
          <div className="value text-right">A&nbsp;{mA?.len ?? "—"}</div>
          <div className="value">B&nbsp;{mB?.len ?? "—"}</div>
        </div>
      </div>

      {/* Badges + Sparklines */}
      <div className="mt-3 flex flex-wrap gap-3">
        <Badges m={mA} />
        <Badges m={mB} />
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="mini-card"><SparklineRow title="Reward" A={mA?.spark?.reward} B={mB?.spark?.reward} /></div>
        <div className="mini-card"><SparklineRow title="Fuel |u|" A={mA?.spark?.fuel} B={mB?.spark?.fuel} fmt={(v)=>v.toFixed(3)} /></div>
        <div className="mini-card"><SparklineRow title="Radial error" A={mA?.spark?.posErr} B={mB?.spark?.posErr} /></div>
        <div className="mini-card"><SparklineRow title="V-tan error" A={mA?.spark?.vTanErr} B={mB?.spark?.vTanErr} /></div>
      </div>

      <div className="footnote">At frame {frameIdx}</div>
    </div>
  );
}

/** -------------- Main App -------------- */
export default function App({ planetsUrl = "/planets.json" }) {
  // View mode
  const [ab, setAb] = useState("A");
  const [split, setSplit] = useState(false);

  // Mission (LLM) + Explain (LLM)
  const [showMission, setShowMission] = useState(false);
  const [mission, setMission] = useState(null);

  // Visual controls
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

  // Load both rollouts (A = random/run_01, B = PPO)
  const { episodes: epsA, metrics: metsA } = useRollout("/rollouts/run_01.json");
  const { episodes: epsB, metrics: metsB } = useRollout("/rollouts/run_ppo.json");

  // Current episode set (for single view)
  const eps = ab === "A" ? epsA : epsB;
  const frames = useMemo(() => eps[activeEp] || [], [eps, activeEp]);

  // Reset frame when switching A/B or episode
  useEffect(() => { setFrameIdx(0); }, [ab, activeEp]);

  // Current/prev frames (for ExplainPanel)
  const frame = frames[Math.floor(frameIdx)] || null;
  const prevFrame = frames[Math.max(0, Math.floor(frameIdx) - 1)] || null;

  // Elements (for Episode card)
  const elements = useMemo(() => (frame ? orbitalElements(frame.r, frame.v, 1.0) : null), [frame]);

  // Events for timeline
  const eventsA = metsA?.[activeEp]?.events || [];

  // Playback + solar time advance
  const lastTime = useRef(performance.now());
  useEffect(() => {
    let raf;
    function tick(now) {
      const dt = (now - lastTime.current) / 1000;
      lastTime.current = now;
      const activeFrames = split ? Math.max((epsA[activeEp]?.length || 0), (epsB[activeEp]?.length || 0)) : frames.length;
      if (playing && activeFrames > 0) {
        const increment = dt * 60 * speed;
        setFrameIdx((i) => Math.min(activeFrames - 1, i + increment));
      }
      setTDays((d) => d + dt * 10 * speed);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, frames.length, speed, split, epsA, epsB, activeEp]);

  const frameIdxInt = Math.floor(frameIdx);

  // Planet colors
  const planetColors = useMemo(() => ({
    Mercury: "#a1a1aa", Venus: "#f59e0b", Earth: "#22c55e", Mars: "#ef4444",
    Jupiter: "#f97316", Saturn: "#fde68a", Uranus: "#7dd3fc", Neptune: "#60a5fa"
  }), []);

  // Hotkeys
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === "b" && !split) setAb((p) => (p === "A" ? "B" : "A"));
      if (k === "s") setSplit((p) => !p);
      if (k === " ") { e.preventDefault(); setPlaying((p) => !p); }
      if (k === "arrowright") setFrameIdx((i) => Math.min((frames.length-1)||0, Math.floor(i)+1));
      if (k === "arrowleft") setFrameIdx((i) => Math.max(0, Math.floor(i)-1));
      if (k === "m") setShowMission(true);
      if (k === "k") {
        setMission({ ...(mission||{}), quickExplain: { from: Math.max(0, Math.floor(frameIdx)-600), to: Math.floor(frameIdx) }});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [split, frames.length, frameIdx, mission]);

  return (
    <div className="min-h-screen bg-lab text-slate-100">
      {/* Proper header */}
      <Header split={split} setSplit={setSplit} setShowMission={setShowMission} />

      <main className="container py-6 space-y-6">
        {/* 4 boxes in one row on wide screens */}
        <section className="grid grid-cols-12 gap-6">
          <div className="col-span-12 xl:col-span-3">
            <PlaybackCard
              ab={ab} setAb={setAb} split={split}
              playing={playing} setPlaying={setPlaying}
              speed={speed} setSpeed={setSpeed}
              frameIdx={frameIdxInt} setFrameIdx={setFrameIdx}
              frames={split ? (epsA[activeEp] || []) : frames}
              eventsA={eventsA}
              showAgent={showAgent} setShowAgent={setShowAgent}
              showTrail={showTrail} setShowTrail={setShowTrail}
              showThrust={showThrust} setShowThrust={setShowThrust}
              showLabels={showLabels} setShowLabels={setShowLabels}
              eccScale={eccScale} setEccScale={setEccScale}
              thrustScale={thrustScale} setThrustScale={setThrustScale}
            />
          </div>

          <div className="col-span-12 xl:col-span-3">
            <EpisodeCard
              episodes={split ? (epsA || []) : (eps || [])}
              activeEp={activeEp}
              setActiveEp={setActiveEp}
              elements={elements}
            />
          </div>

          <div className="col-span-12 xl:col-span-3">
            <QuickStatus mA={metsA?.[activeEp]} mB={metsB?.[activeEp]} />
          </div>

          <div className="col-span-12 xl:col-span-3">
            <EpisodeSnapshot mA={metsA?.[activeEp]} mB={metsB?.[activeEp]} />
          </div>
        </section>

        {/* Analytics (A vs B inline values inside one box) */}
        <section className="grid grid-cols-12 gap-6">
          <div className="col-span-12">
            <ComparePanel mA={metsA?.[activeEp]} mB={metsB?.[activeEp]} frameIdx={frameIdxInt} />
          </div>
        </section>

        {/* Canvas — Single or Split side-by-side */}
        <section className="grid grid-cols-12 gap-6">
          {!split ? (
            <div className="col-span-12">
              <div style={{ height: "78vh", width: "100%" }} className="canvas-shell">
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
            </div>
          ) : (
            <>
              <div className="col-span-12 lg:col-span-6">
                <div style={{ height: "70vh", width: "100%" }} className="canvas-shell">
                  <Scene3D
                    frames={epsA[activeEp] || []}
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
              </div>
              <div className="col-span-12 lg:col-span-6">
                <div style={{ height: "70vh", width: "100%" }} className="canvas-shell">
                  <Scene3D
                    frames={epsB[activeEp] || []}
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
              </div>
            </>
          )}
        </section>

        {/* Automation / Ask AI — centered with 10px side padding */}
        <section className="w-full">
          <div className="mx-auto max-w-5xl px-[10px]">
            <div className="card">
              <h3 className="section-title">Automation — Ask AI</h3>
              <ExplainPanel frame={frame} prevFrame={prevFrame} mission={mission} />
            </div>
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
