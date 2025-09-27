import React, { useState } from "react";

/**
 * ExplainPanel
 * - Sends current frame (and a little context) to /api/llm and shows a natural-language explanation
 *
 * Props:
 *  - frame (object from rollout)  — expects r, v, thrust, reward, etc.
 *  - prevFrame (object | null)
 *  - mission (optional mission object for context)
 */
export default function ExplainPanel({ frame, prevFrame, mission }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function explain() {
    if (!frame) {
      setText("No frame selected.");
      return;
    }
    setBusy(true);
    setText("");
    try {
      const payload = {
        system:
          "You are an expert orbital mechanics tutor. Explain clearly and briefly for a portfolio app.",
        prompt:
          `Given the current satellite state and optional mission, explain what's happening.\n` +
          `Return plain text (no markdown tables).\n\n` +
          `MISSION: ${mission ? JSON.stringify(mission) : "None"}\n` +
          `CURRENT_FRAME: ${JSON.stringify(frame)}\n` +
          `PREV_FRAME: ${prevFrame ? JSON.stringify(prevFrame) : "None"}\n`,
      };
      const resp = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      setText(data.text || "(no response)");
    } catch (e) {
      console.error(e);
      setText("LLM request failed. Check console/server logs.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-white/70 text-slate-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Explain this moment</h3>
        <button
          onClick={explain}
          disabled={busy}
          className="px-3 py-1 rounded bg-slate-900 text-white disabled:opacity-50"
        >
          {busy ? "Asking…" : "Ask AI"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap text-sm leading-relaxed">
        {text || "Click “Ask AI” to get a short explanation of the current state (thrust, energy, errors)."}
      </pre>
    </div>
  );
}
