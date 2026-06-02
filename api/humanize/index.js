import { withApiGuards, callOpenAI, postProcess } from "../_lib/helpers.js";

async function humanize(req, res) {
  const { text, prompt } = req.body;
  try {
    const raw = await callOpenAI(prompt, text);
    return res.status(200).json({ content: postProcess(raw) });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Humanization failed." } });
  }
}

export default withApiGuards(humanize);
