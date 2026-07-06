import { withApiGuards, callOpenAI, postProcess, buildSystemPrompt, REFINE_PROMPT } from "../_lib/helpers.js";

export const config = { maxDuration: 60 };

async function deep(req, res) {
  const { text, fluency, tone, length, model } = req.body;
  const prompt = buildSystemPrompt(fluency, tone, length);
  const seed = Math.floor(Math.random() * 0xFFFFFFFF);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ type: "progress", pass: 1, total: 3, status: "Humanizing original text..." });
    const pass1 = await callOpenAI(prompt, text, 0.95, model);
    send({ type: "pass_result", pass: 1, text: postProcess(pass1, seed) });

    send({ type: "progress", pass: 2, total: 3, status: "AI deep refinement pass..." });
    const pass2 = await callOpenAI(REFINE_PROMPT, pass1, 0.95, model);
    send({ type: "pass_result", pass: 2, text: postProcess(pass2, seed) });

    send({ type: "progress", pass: 3, total: 3, status: "Statistical token transformation..." });
    const final = postProcess(pass2, seed);
    send({ type: "pass_result", pass: 3, text: final });
    send({ type: "done", text: final });
  } catch (err) {
    send({ type: "error", message: err.message });
  }

  res.write("data: [DONE]\n\n");
  res.end();
}

export default withApiGuards(deep);
