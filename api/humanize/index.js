import { withApiGuards, callOpenAI, postProcess, buildSystemPrompt } from "../_lib/helpers.js";

async function humanize(req, res) {
  const { text, fluency, tone, length } = req.body;
  const prompt = buildSystemPrompt(fluency, tone, length);
  const seed = Math.floor(Math.random() * 0xFFFFFFFF);
  try {
    const raw = await callOpenAI(prompt, text);
    return res.status(200).json({ content: postProcess(raw, seed) });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Humanization failed." } });
  }
}

export default withApiGuards(humanize);
