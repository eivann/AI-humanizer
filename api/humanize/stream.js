import { setCors, callOpenAI, postProcess } from "../_lib/helpers.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });

  const API_KEY = process.env.FREEMODEL_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: { message: "API key not configured." } });

  const { text, prompt } = req.body;
  if (!text || !prompt) return res.status(400).json({ error: { message: "'text' and 'prompt' are required." } });

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const raw = await callOpenAI(prompt, text);
    const processed = postProcess(raw);
    // Stream the result word by word for a live typing effect
    const words = processed.split(" ");
    for (let i = 0; i < words.length; i++) {
      send({ text: (i === 0 ? "" : " ") + words[i] });
    }
  } catch (err) {
    send({ error: err.message });
  }

  res.write("data: [DONE]\n\n");
  res.end();
}
