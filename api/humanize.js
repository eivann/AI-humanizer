import { setCors, callOpenAI, postProcess } from "./_lib/helpers.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });

  const API_KEY = process.env.FREEMODEL_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: { message: "API key not configured." } });

  const { text, prompt, skipPostProcess } = req.body;
  if (!text || !prompt) return res.status(400).json({ error: { message: "'text' and 'prompt' are required." } });

  try {
    const raw = await callOpenAI(prompt, text);
    const result = skipPostProcess ? raw : postProcess(raw);
    return res.status(200).json({ content: result });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Humanization failed." } });
  }
}
