import { withApiGuards, callOpenAI, postProcess } from "../_lib/helpers.js";

export const config = { maxDuration: 60 };

async function variations(req, res) {
  const { text, prompt } = req.body;
  try {
    const [r1, r2, r3] = await Promise.all([
      callOpenAI(prompt, text, 0.8),
      callOpenAI(prompt, text, 0.95),
      callOpenAI(prompt, text, 1.1),
    ]);
    return res.status(200).json({
      variations: [postProcess(r1), postProcess(r2), postProcess(r3)],
    });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to generate variations." } });
  }
}

export default withApiGuards(variations);
