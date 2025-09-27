// server/index.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

async function callLLM({ system, prompt, json = false }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const r = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt || "Explain." },
      ],
      temperature: 0.3,
      response_format: json ? { type: "json_object" } : undefined,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || "OpenAI error");
  return data?.choices?.[0]?.message?.content ?? "";
}

/** generic passthrough (keep) */
app.post("/api/llm", async (req, res) => {
  try {
    const text = await callLLM(req.body || {});
    res.json({ text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** expected by MissionModal.jsx */
app.post("/api/mission", async (req, res) => {
  try {
    const { prompt } = req.body || {};
    const system =
      "You are MissionGen, a tool that turns natural language into a JSON mission spec for an orbital RL task. " +
      "Return a single JSON object with keys: goal, constraints, horizon, targetRadius, tolerance, notes.";
    const text = await callLLM({ system, prompt, json: true });
    let obj;
    try { obj = JSON.parse(text); } catch { obj = { error: "Bad JSON from model", raw: text }; }
    res.json(obj);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** expected by ExplainPanel.jsx */
app.post("/api/explain", async (req, res) => {
  try {
    const { summary } = req.body || {}; // { stats, events, goals }
    const system =
      "You are an orbital dynamics coach. Given rollout stats/events/goals, produce a concise explanation. " +
      "Return JSON with keys: insight (string), suggestions (array of strings), anomalies (array of strings).";
    const prompt = `SUMMARY:\n${JSON.stringify(summary, null, 2)}`;
    const text = await callLLM({ system, prompt, json: true });
    let obj;
    try { obj = JSON.parse(text); } catch { obj = { error: "Bad JSON from model", raw: text }; }
    res.json(obj);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log("LLM server on http://localhost:" + port));
