// api/llm.js  (Vercel serverless function)
export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  
    const { system, prompt, json } = req.body || {};
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt || "Explain." },
          ],
          temperature: 0.3,
          response_format: json ? { type: "json_object" } : undefined,
        }),
      });
  
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content ?? "";
      res.status(200).json({ text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "LLM call failed" });
    }
  }
  