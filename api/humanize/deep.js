import { setCors, callOpenAI, postProcess, REFINE_PROMPT } from "../_lib/helpers.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });

  const API_KEY = process.env.FREEMODEL_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: { message: "API key not configured." } });

  const { text, prompt } = req.body;
  if (!text || !prompt) return res.status(400).json({ error: { message: "'text' and 'prompt' are required." } });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ type: "progress", pass: 1, total: 3, status: "Humanizing original text..." });
    const pass1 = await callOpenAI(prompt, text);
    send({ type: "pass_result", pass: 1, text: postProcess(pass1) });

    send({ type: "progress", pass: 2, total: 3, status: "AI deep refinement pass..." });
    const pass2 = await callOpenAI(REFINE_PROMPT, pass1);
    send({ type: "pass_result", pass: 2, text: postProcess(pass2) });

    send({ type: "progress", pass: 3, total: 3, status: "Statistical token transformation..." });
    const final = postProcess(pass2);
    send({ type: "pass_result", pass: 3, text: final });
    send({ type: "done", text: final });
  } catch (err) {
    send({ type: "error", message: err.message });
  }

  res.write("data: [DONE]\n\n");
  res.end();
}
