import { setCors, callOpenAI, postProcess } from "../../_lib/helpers.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });

  const API_KEY = process.env.FREEMODEL_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: { message: "API key not configured." } });

  const { text, prompt } = req.body;
  if (!text || !prompt) return res.status(400).json({ error: { message: "'text' and 'prompt' are required." } });

  try {
    const [r1, r2, r3] = await Promise.all([
      callOpenAI(prompt, text, 0.8),
      callOpenAI(prompt, text, 0.95),
      callOpenAI(prompt, text, 1.1),
    ]);
    return res.status(200).json({ variations: [postProcess(r1), postProcess(r2), postProcess(r3)] });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to generate variations." } });
  }
}
