import React, { useState } from "react";

/**
 * MissionModal
 * - Lets you define/preview a station-keeping mission (target radius, tolerances, horizon)
 * - Optional: "Ask AI" to suggest parameters from a short goal description
 *
 * Props:
 *  - open (bool), onClose()
 *  - onCreate(missionObj)
 *  - defaultMission (object) optional
 */
export default function MissionModal({ open, onClose, onCreate, defaultMission }) {
  const [tab, setTab] = useState("manual");
  const [goalText, setGoalText] = useState("Hold a 1.0 AU circular orbit with minimal fuel.");
  const [loadingAI, setLoadingAI] = useState(false);

  const [mission, setMission] = useState(
    defaultMission || {
      name: "Station keeping @ 1 AU",
      r_target: 1.0,
      tol_r: 0.05,
      tol_v: 0.05,
      max_steps: 3000,
      thrust_max: 0.02,
      reward_weights: { w_pos: 1.0, w_vel: 0.5, w_fuel: 0.05 },
    }
  );

  if (!open) return null;

  async function askAI() {
    try {
      setLoadingAI(true);
      const resp = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: "You are an orbital mechanics tutor. Output compact JSON only.",
          prompt:
            `Suggest mission parameters for a satellite station-keeping task from this description.\n` +
            `Return JSON with keys: name, r_target, tol_r, tol_v, max_steps, thrust_max, reward_weights({w_pos,w_vel,w_fuel}).\n` +
            `Description: ${goalText}`,
          json: true,
        }),
      });
      const data = await resp.json();
      // data.text should be JSON
      let parsed = mission;
      try { parsed = JSON.parse(data.text); } catch {}
      // apply partial updates safely
      setMission((m) => ({
        ...m,
        ...parsed,
        reward_weights: { ...(m.reward_weights||{}), ...(parsed.reward_weights||{}) },
      }));
      setTab("manual");
    } catch (e) {
      console.error(e);
      alert("AI suggestion failed. Check server logs.");
    } finally {
      setLoadingAI(false);
    }
  }

  function update(k, v) {
    setMission((m) => ({ ...m, [k]: v }));
  }
  function updateRW(k, v) {
    setMission((m) => ({ ...m, reward_weights: { ...m.reward_weights, [k]: v }}));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white text-slate-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Create Mission</h2>
          <button onClick={onClose} className="text-sm px-2 py-1 rounded border">Close</button>
        </div>

        <div className="px-5 pt-3">
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setTab("manual")}
              className={`px-3 py-1 rounded ${tab==="manual"?"bg-slate-900 text-white":"border"}`}
            >Manual</button>
            <button
              onClick={() => setTab("ai")}
              className={`px-3 py-1 rounded ${tab==="ai"?"bg-slate-900 text-white":"border"}`}
            >Ask AI</button>
          </div>

          {tab === "ai" ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium">Describe your mission goal</label>
              <textarea
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                rows={4}
                className="w-full rounded border p-2"
                placeholder="e.g., Maintain 1 AU circular orbit, prefer low fuel usage."
              />
              <button
                onClick={askAI}
                disabled={loadingAI}
                className="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
              >
                {loadingAI ? "Thinking…" : "Suggest parameters"}
              </button>
              <p className="text-xs text-slate-500">
                This calls <code>/api/llm</code> on your backend—your API key stays server-side.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm">Mission name</label>
                <input className="w-full rounded border p-2"
                       value={mission.name}
                       onChange={(e)=>update("name", e.target.value)} />
              </div>
              <div>
                <label className="text-sm">Target radius (r_target)</label>
                <input type="number" step="0.01" className="w-full rounded border p-2"
                       value={mission.r_target}
                       onChange={(e)=>update("r_target", parseFloat(e.target.value)||0)} />
              </div>
              <div>
                <label className="text-sm">Tolerance r (tol_r)</label>
                <input type="number" step="0.01" className="w-full rounded border p-2"
                       value={mission.tol_r}
                       onChange={(e)=>update("tol_r", parseFloat(e.target.value)||0)} />
              </div>
              <div>
                <label className="text-sm">Tolerance v (tol_v)</label>
                <input type="number" step="0.01" className="w-full rounded border p-2"
                       value={mission.tol_v}
                       onChange={(e)=>update("tol_v", parseFloat(e.target.value)||0)} />
              </div>
              <div>
                <label className="text-sm">Max steps</label>
                <input type="number" className="w-full rounded border p-2"
                       value={mission.max_steps}
                       onChange={(e)=>update("max_steps", parseInt(e.target.value)||0)} />
              </div>
              <div>
                <label className="text-sm">Max thrust</label>
                <input type="number" step="0.001" className="w-full rounded border p-2"
                       value={mission.thrust_max}
                       onChange={(e)=>update("thrust_max", parseFloat(e.target.value)||0)} />
              </div>
              <div>
                <label className="text-sm">w_pos</label>
                <input type="number" step="0.01" className="w-full rounded border p-2"
                       value={mission.reward_weights.w_pos}
                       onChange={(e)=>updateRW("w_pos", parseFloat(e.target.value)||0)} />
              </div>
              <div>
                <label className="text-sm">w_vel</label>
                <input type="number" step="0.01" className="w-full rounded border p-2"
                       value={mission.reward_weights.w_vel}
                       onChange={(e)=>updateRW("w_vel", parseFloat(e.target.value)||0)} />
              </div>
              <div>
                <label className="text-sm">w_fuel</label>
                <input type="number" step="0.01" className="w-full rounded border p-2"
                       value={mission.reward_weights.w_fuel}
                       onChange={(e)=>updateRW("w_fuel", parseFloat(e.target.value)||0)} />
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded border">Cancel</button>
          <button
            onClick={()=>{ onCreate?.(mission); onClose?.(); }}
            className="px-4 py-2 rounded bg-slate-900 text-white"
          >
            Create mission
          </button>
        </div>
      </div>
    </div>
  );
}
