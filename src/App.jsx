import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Html, GizmoHelper, GizmoViewport, StatsGl } from "@react-three/drei";

/**
 * Orbital RL + Solar System Frontend
 * - Keplerian planets (colored), labels (toggleable)
 * - Agent rollout (toggle Random vs Learned), optional trail + thrust
 * - Eccentricity scale (visualization) + Thrust arrow scale
 * - Large canvas stage; text controls at top
 */

/********************** Utils ************************/
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

/********************** Data Loaders ************************/
async function loadRollout(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch rollout: ${res.status} (${url})`);
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

/********************** Kepler helpers ************************/
function keplerE(M, e) {
  let E = M;
  for (let k = 0; k < 8; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    E -= f / fp;
  }
  return E;
}

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

/********************** R3F Scene Pieces ************************/
function Satellite({ frame }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current && frame) {
      const p = frame.r;
      ref.current.position.set(p[0], p[1], p[2]);
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
  const p = frame.r;
  const u = frame.thrust;
  const magnitude = Math.hypot(u[0], u[1], u[2]);
  if (magnitude < 1e-8) return null;
  const s = baseScale * thrustScale;
  const end = [p[0] + u[0] * s, p[1] + u[1] * s, p[2] + u[2] * s];
  return <Line points={[p, end]} lineWidth={2} color="#38bdf8" />;
}

function Trail({ frames, every = 2, maxPoints = 2000 }) {
  const points = useMemo(() => {
    const pts = [];
    for (let i = 0; i < frames.length; i += every) {
      pts.push(frames[i].r);
      if (pts.length >= maxPoints) break;
    }
    return pts;
  }, [frames, every, maxPoints]);
  if (points.length < 2) return null;
  return <Line points={points} lineWidth={1} color="#22d3ee" />;
}

function Planets({ planets, tDays, scaleAU = 1.5, planetColors, showLabels, eccScale = 1 }) {
  const mu = 0.0002959122082855911; // AU^3/day^2
  const rad = Math.PI / 180;
  return (
    <group>
      {planets.map((p) => {
        const eVis = Math.min(p.e * eccScale, 0.9); // exaggerate visually; clamp for stability
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
  frames, frameIdx, showTrail, showThrust, planets, tDays,
  showAgent, showLabels, planetColors, eccScale, thrustScale
}) {
  const frame = frames[clamp(frameIdx, 0, frames.length - 1)] || null;

  return (
    <Canvas camera={{ position: [2.8, 2.2, 2.8], fov: 45 }} style={{ width: "100%", height: "100%" }}>
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 0, 0]} intensity={1.6} color="#fff8e1" />

      {/* Sun */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.1, 48, 48]} />
        <meshStandardMaterial color="#ffd166" emissive="#ffb703" emissiveIntensity={1.5} roughness={0.25} metalness={0.1} />
      </mesh>

      {/* Planets */}
      {planets?.length > 0 && (
        <Planets
          planets={planets}
          tDays={tDays}
          scaleAU={1.5}
          planetColors={planetColors}
          showLabels={showLabels}
          eccScale={eccScale}
        />
      )}

      {/* Agent visuals (only when enabled) */}
      {showAgent && showTrail && <Trail frames={frames} />}
      {showAgent && frame && <Satellite frame={frame} />}
      {showAgent && showThrust && frame && <ThrustVector frame={frame} thrustScale={thrustScale} />}

      {/* Optional agent label */}
      {showAgent && frame && (
        <Html position={frame.r} distanceFactor={25} style={{ pointerEvents: "none" }}>
          <div
            style={{
              fontSize: 11,
              fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
              color: "#e5e7eb",
              background: "rgba(0,0,0,0.35)",
              padding: "2px 6px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)"
            }}
          >
            Agent
          </div>
        </Html>
      )}

      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
      <OrbitControls enableDamping makeDefault />
      <StatsGl className="hidden md:block" />
    </Canvas>
  );
}

/********************** HUD & Controls ************************/
function HUD({
  episodes, activeEp, setActiveEp, playing, setPlaying, speed, setSpeed,
  frameIdx, setFrameIdx, frames,
  showTrail, setShowTrail, showThrust, setShowThrust,
  showAgent, setShowAgent,
  showLabels, setShowLabels,
  eccScale, setEccScale,
  thrustScale, setThrustScale,
  rolloutUrl, setRolloutUrl, rolloutOptions
}) {
  const frame = frames[clamp(frameIdx, 0, frames.length - 1)];
  const elements = useMemo(() => (frame ? orbitalElements(frame.r, frame.v, 1.0) : null), [frame]);
  const rewardNow = frame?.reward?.toFixed(3);

  return (
    <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
      {/* Playback and Rollout Toggle */}
      <div className="p-4 rounded-2xl bg-white/70 backdrop-blur border">
        <h2 className="text-lg font-semibold mb-2">Playback</h2>

        <div className="flex items-center gap-2">
          <button onClick={() => setPlaying(!playing)} className="px-3 py-1 rounded-xl border">
            {playing ? "Pause" : "Play"}
          </button>
          <label className="text-sm">Speed</label>
          <input
            type="range" min="0.1" max="5" step="0.1"
            value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-40"
          />
          <span className="text-sm w-10 text-center">{speed.toFixed(1)}x</span>
        </div>

        <div className="mt-2">
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={frameIdx}
            onChange={(e) => setFrameIdx(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-600 mt-1">
            Frame {frameIdx}/{Math.max(0, frames.length - 1)}
          </div>
        </div>

        {/* Rollout selector */}
        <div className="mt-3">
          <label className="text-sm block mb-1">Rollout file</label>
          <select
            value={rolloutUrl}
            onChange={(e) => {
              setRolloutUrl(e.target.value);
              setActiveEp(0);
              setFrameIdx(0);
            }}
            className="px-2 py-1 rounded-xl border bg-white/80 text-slate-900"
          >
            {rolloutOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
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
            <input
              type="range" min="1" max="4" step="0.1"
              value={eccScale} onChange={(e) => setEccScale(Number(e.target.value))}
              className="w-40"
            />
            <span className="w-12 text-right">{eccScale.toFixed(1)}×</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap">Thrust arrow scale</span>
            <input
              type="range" min="1" max="200" step="1"
              value={thrustScale} onChange={(e) => setThrustScale(Number(e.target.value))}
              className="w-40"
            />
            <span className="w-12 text-right">{thrustScale}×</span>
          </div>
        </div>
      </div>

      {/* Episode selector */}
      <div className="p-4 rounded-2xl bg-white/70 backdrop-blur border">
        <h2 className="text-lg font-semibold mb-2">Episode</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeEp}
            onChange={(e) => { const i = Number(e.target.value); setActiveEp(i); setFrameIdx(0); }}
            className="px-2 py-1 rounded-xl border"
          >
            {episodes.map((ep, i) => (
              <option key={i} value={i}>Episode {i + 1} ({ep.length} frames)</option>
            ))}
          </select>
          <button onClick={() => setFrameIdx(0)} className="px-3 py-1 rounded-xl border">Restart</button>
        </div>
      </div>

      {/* Metrics */}
      <div className="p-4 rounded-2xl bg-white/70 backdrop-blur border">
        <h2 className="text-lg font-semibold mb-2">Agent Metrics (μ=1)</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="text-gray-600">a (semi-major)</div><div>{elements ? elements.a.toFixed(3) : "—"}</div>
          <div className="text-gray-600">e (eccentricity)</div><div>{elements ? elements.e.toFixed(3) : "—"}</div>
          <div className="text-gray-600">|H| (ang. mom)</div><div>{elements ? elements.hmag.toFixed(3) : "—"}</div>
          <div className="text-gray-600">Energy</div><div>{elements ? elements.energy.toFixed(3) : "—"}</div>
          <div className="text-gray-600">Reward</div><div>{rewardNow ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}

/********************** Main App ************************/
export default function App({ rolloutUrl = "/rollouts/run_01.json", planetsUrl = "/planets.json" }) {
  // Rollout toggle state
  const [rolloutUrlState, setRolloutUrlState] = useState(rolloutUrl);
  const rolloutOptions = useMemo(() => ([
    { label: "Random (run_01.json)",  value: "/rollouts/run_01.json" },
    { label: "Learned PPO (run_ppo.json)", value: "/rollouts/run_ppo.json" },
  ]), []);

  // Episodes / playback
  const [episodes, setEpisodes] = useState([]);
  const [activeEp, setActiveEp] = useState(0);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1.0);

  // Visual toggles
  const [showTrail, setShowTrail] = useState(true);
  const [showThrust, setShowThrust] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [eccScale, setEccScale] = useState(1.0);
  const [thrustScale, setThrustScale] = useState(50);

  // Solar system state
  const [planets, setPlanets] = useState([]);
  const [tDays, setTDays] = useState(0);

  // Load episodes whenever the rollout changes
  useEffect(() => {
    loadRollout(rolloutUrlState)
      .then((eps) => {
        setEpisodes(eps);
        setActiveEp(0);
        setFrameIdx(0);
      })
      .catch(console.error);
  }, [rolloutUrlState]);

  // Load planets once
  useEffect(() => {
    loadPlanets(planetsUrl).then(setPlanets).catch(console.error);
  }, [planetsUrl]);

  const frames = useMemo(() => episodes[activeEp] || [], [episodes, activeEp]);

  // Playback tick
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

  const frameIdxInt = Math.floor(frameIdx);

  // Planet colors
  const planetColors = useMemo(() => ({
    Mercury: "#a1a1aa",
    Venus:   "#f59e0b",
    Earth:   "#22c55e",
    Mars:    "#ef4444",
    Jupiter: "#f97316",
    Saturn:  "#fde68a",
    Uranus:  "#7dd3fc",
    Neptune: "#60a5fa"
  }), []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-4 md:p-8">
      <header className="max-w-6xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Orbital RL + Solar System</h1>
        <p className="text-slate-300 mt-1">Toggle between Random and Learned rollouts; visualize thrust and orbital geometry.</p>
      </header>

      <main className="max-w-6xl mx-auto">
        <div className="mt-4">
          <HUD
            episodes={episodes}
            activeEp={activeEp}
            setActiveEp={(i) => { setActiveEp(i); setFrameIdx(0); }}
            playing={playing}
            setPlaying={setPlaying}
            speed={speed}
            setSpeed={setSpeed}
            frameIdx={frameIdxInt}
            setFrameIdx={(i) => setFrameIdx(i)}
            frames={frames}
            showTrail={showTrail}
            setShowTrail={setShowTrail}
            showThrust={showThrust}
            setShowThrust={setShowThrust}
            showAgent={showAgent}
            setShowAgent={setShowAgent}
            showLabels={showLabels}
            setShowLabels={setShowLabels}
            eccScale={eccScale}
            setEccScale={setEccScale}
            thrustScale={thrustScale}
            setThrustScale={setThrustScale}
            rolloutUrl={rolloutUrlState}
            setRolloutUrl={setRolloutUrlState}
            rolloutOptions={rolloutOptions}
          />
        </div>
      </main>

      {/* Big canvas */}
      <section className="mt-6 w-full">
        <div
          style={{ height: "88vh", width: "100%" }}
          className="mx-auto max-w-[1400px] w-full rounded-3xl border border-white/10 bg-white/5 overflow-hidden shadow-2xl"
        >
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
    </div>
  );
}
