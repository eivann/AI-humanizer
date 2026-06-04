import { withApiGuards, callOpenAI, postProcess, buildSystemPrompt } from "../_lib/helpers.js";

export const config = { maxDuration: 60 };

async function variations(req, res) {
  const { text, fluency, tone, length } = req.body;
  const prompt = buildSystemPrompt(fluency, tone, length);
  // Three independent seeds — each variation is internally coherent
  // but the three variations differ from each other.
  const seedBase = Math.floor(Math.random() * 0xFFFFFFFF);
  const seeds = [seedBase, (seedBase ^ 0xA5A5A5A5) >>> 0, (seedBase ^ 0x5A5A5A5A) >>> 0];

  try {
    const [r1, r2, r3] = await Promise.all([
      callOpenAI(prompt, text, 0.8),
      callOpenAI(prompt, text, 0.95),
      callOpenAI(prompt, text, 1.1),
    ]);
    return res.status(200).json({
      variations: [
        postProcess(r1, seeds[0]),
        postProcess(r2, seeds[1]),
        postProcess(r3, seeds[2]),
      ],
    });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to generate variations." } });
  }
}

export default withApiGuards(variations);
