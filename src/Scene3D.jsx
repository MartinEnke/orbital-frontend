// src/Scene3D.jsx
import React, { useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Html, GizmoHelper, GizmoViewport, StatsGl } from "@react-three/drei";

/** ---------- small utils (local to scene) ---------- */
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

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

/** ---------- scene bits ---------- */
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
  const mag = Math.hypot(u[0], u[1], u[2]); if (mag < 1e-8) return null;
  const s = baseScale * thrustScale;
  const end = [p[0] + u[0]*s, p[1] + u[1]*s, p[2] + u[2]*s];
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

/** ---------- main scene ---------- */
export default function Scene3D({
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

      {/* Agent */}
      {showAgent && showTrail && frames?.length > 1 && <Trail frames={frames} />}
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
