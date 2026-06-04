// Shared post-processing pipeline and AI call utilities
// Used by all Vercel API route handlers

const SYNONYM_MAP = {
  "utilize": ["use", "work with", "rely on"],
  "facilitate": ["help", "make easier", "support"],
  "comprehensive": ["full", "complete", "thorough"],
  "demonstrate": ["show", "prove", "make clear"],
  "implement": ["set up", "put in place", "roll out"],
  "enhance": ["improve", "boost", "make better"],
  "establish": ["set up", "create", "build"],
  "maintain": ["keep", "hold onto", "stick with"],
  "determine": ["figure out", "decide", "find out"],
  "indicate": ["show", "suggest", "point to"],
  "require": ["need", "call for"],
  "obtain": ["get", "grab", "pick up"],
  "sufficient": ["enough", "plenty"],
  "numerous": ["many", "a bunch of", "lots of"],
  "various": ["different", "all kinds of", "a range of"],
  "regarding": ["about", "when it comes to", "on"],
  "therefore": ["so", "that's why", "because of this"],
  "however": ["but", "still", "though"],
  "although": ["even though", "while"],
  "nevertheless": ["still", "even so", "but"],
  "essentially": ["basically", "really"],
  "particularly": ["especially", "mainly"],
  "approximately": ["about", "around", "roughly"],
  "immediately": ["right away", "straight away"],
  "previously": ["before", "earlier"],
  "subsequently": ["then", "after that", "later"],
  "significant": ["big", "major", "real"],
  "effective": ["solid", "strong"],
  "efficient": ["quick", "smooth"],
  "incorporate": ["include", "add", "bring in"],
  "ultimately": ["in the end", "at the end of the day"],
  "additionally": ["also", "plus", "on top of that"],
  "significantly": ["a lot", "quite a bit", "noticeably"],
  "consequently": ["so", "because of that"],
  "crucial": ["key", "important", "big"],
  "pivotal": ["key", "turning-point", "major"],
  "robust": ["strong", "solid", "tough"],
  "streamline": ["simplify", "clean up", "smooth out"],
  "leverage": ["use", "take advantage of", "tap into"],
  "foster": ["build", "grow", "encourage"],
  "harness": ["use", "tap into", "channel"],
  "underpinned": ["backed by", "supported by", "built on"],
  "underscore": ["highlight", "stress", "show"],
  "realm": ["area", "space", "world"],
  "myriad": ["tons of", "loads of", "a whole bunch of"],
  "plethora": ["a lot of", "plenty of", "loads of"],
  "Moreover": ["Plus", "Also", "And"],
  "Furthermore": ["On top of that", "Plus", "And"],
  "In conclusion": ["So basically", "To wrap up", "All in all"],
  "In summary": ["So", "Basically", "Long story short"],
  "It is important to note": ["Worth noting", "Keep in mind"],
  "It should be noted": ["Worth mentioning", "One thing to note"],
  "In order to": ["To"],
  "Due to the fact that": ["Because", "Since"],
  "In light of": ["Given", "Because of", "Considering"],
  "With regard to": ["About", "On", "When it comes to"],
  "As a result": ["So", "Because of this", "That's why"],
  "On the other hand": ["Then again", "But", "At the same time"],
  "In addition": ["Also", "Plus", "And"],
  "For instance": ["Like", "Take"],
  "For example": ["Like", "Say"],
  "going to": ["gonna"],
  "got to": ["gotta"],
  "want to": ["wanna"],
  "a lot of": ["a ton of", "a bunch of"],
  "very": ["super", "really", "pretty"],
  "extremely": ["super", "really", "insanely"],
};

const CONTRACTION_MAP = [
  [/\bdo not\b/gi, "don't"], [/\bdoes not\b/gi, "doesn't"], [/\bdid not\b/gi, "didn't"],
  [/\bcannot\b/gi, "can't"], [/\bwill not\b/gi, "won't"], [/\bwould not\b/gi, "wouldn't"],
  [/\bshould not\b/gi, "shouldn't"], [/\bcould not\b/gi, "couldn't"],
  [/\bis not\b/gi, "isn't"], [/\bare not\b/gi, "aren't"],
  [/\bwas not\b/gi, "wasn't"], [/\bwere not\b/gi, "weren't"],
  [/\bhas not\b/gi, "hasn't"], [/\bhave not\b/gi, "haven't"], [/\bhad not\b/gi, "hadn't"],
  [/\bI am\b/g, "I'm"], [/\bI have\b/g, "I've"], [/\bI will\b/g, "I'll"], [/\bI would\b/g, "I'd"],
  [/\bwe have\b/gi, "we've"], [/\bwe will\b/gi, "we'll"], [/\bwe are\b/gi, "we're"],
  [/\bthey have\b/gi, "they've"], [/\bthey will\b/gi, "they'll"], [/\bthey are\b/gi, "they're"],
  [/\byou are\b/gi, "you're"], [/\byou have\b/gi, "you've"], [/\byou will\b/gi, "you'll"],
  [/\bit is\b/gi, "it's"], [/\bit will\b/gi, "it'll"], [/\bthat is\b/gi, "that's"],
  [/\bthere is\b/gi, "there's"], [/\bwho is\b/gi, "who's"], [/\bwhat is\b/gi, "what's"],
  [/\blet us\b/gi, "let's"],
];

const INFORMAL_INSERTS = [
  ", honestly,", ", really,", ", basically,", " — and that's kind of the point —",
  ", to be fair,", ", which is pretty interesting,", ", if you think about it,",
  ", which matters more than people realize,", ", and I think that's the key part,",
];

const HUMAN_OPENERS = [
  "Look, ", "Honestly, ", "Here's the thing — ", "So basically, ",
  "The thing is, ", "I mean, ", "And honestly, ", "Truth is, ",
  "To be fair, ", "What's interesting is ", "The real story here is ",
];

const DASH_INTERJECTIONS = [
  "— and this is important —",
  "— which is actually pretty wild —",
  "— at least in most cases —",
  "— not that it's obvious —",
  "— though it depends —",
  "— worth keeping in mind —",
];

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Must match the MAX_CHARS constant in src/app/App.tsx.
// The Vercel API build root cannot import from src/, so this is
// duplicated by convention — keep them in sync.
export const MAX_CHARS = 5000;

export function validateHumanizeBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, message: "Request body must be a JSON object." };
  }
  const { text, prompt } = body;
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, status: 400, message: "'text' is required and must be a non-empty string." };
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return { ok: false, status: 400, message: "'prompt' is required and must be a non-empty string." };
  }
  if (text.length > MAX_CHARS) {
    return { ok: false, status: 413, message: `'text' exceeds ${MAX_CHARS} character limit.` };
  }
  return { ok: true };
}

export function withApiGuards(handler, { methods = ["POST"] } = {}) {
  return async function guardedHandler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (!methods.includes(req.method)) {
      return res.status(405).json({ error: { message: "Method not allowed" } });
    }
    if (!process.env.FREEMODEL_API_KEY) {
      return res.status(500).json({ error: { message: "API key not configured." } });
    }
    const v = validateHumanizeBody(req.body);
    if (!v.ok) {
      return res.status(v.status).json({ error: { message: v.message } });
    }
    return handler(req, res);
  };
}

export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function postProcess(text) {
  let result = text;

  const phraseEntries = Object.entries(SYNONYM_MAP).filter(([k]) => k.includes(" "));
  const wordEntries = Object.entries(SYNONYM_MAP).filter(([k]) => !k.includes(" "));

  for (const [phrase, alts] of phraseEntries) {
    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    result = result.replace(regex, () => pick(alts));
  }
  for (const [word, alts] of wordEntries) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    result = result.replace(regex, () => pick(alts));
  }

  for (const [regex, replacement] of CONTRACTION_MAP) {
    result = result.replace(regex, replacement);
  }

  const sentences = result.match(/[^.!?]+[.!?]+/g) || [result];
  const processed = [];

  for (let i = 0; i < sentences.length; i++) {
    let s = sentences[i].trim();
    if (!s) continue;

    if (Math.random() < 0.22 && !s.match(/^(Look|Honestly|So|I mean|Basically|The thing|Actually|Truth|To be fair|What'?s|And)/i)) {
      const opener = pick(HUMAN_OPENERS);
      s = opener + s.charAt(0).toLowerCase() + s.slice(1);
    }

    if (Math.random() < 0.18 && s.includes(",")) {
      const commaIdx = s.indexOf(",");
      if (commaIdx > 8 && commaIdx < s.length - 12) {
        s = s.substring(0, commaIdx) + pick(INFORMAL_INSERTS) + s.substring(commaIdx + 1);
      }
    }

    if (Math.random() < 0.14) {
      const words = s.split(" ");
      if (words.length > 7) {
        words.splice(Math.floor(words.length * 0.45), 0, pick(DASH_INTERJECTIONS));
        s = words.join(" ");
      }
    }

    if (Math.random() < 0.15 && s.length > 75) {
      for (const sp of [" and ", " but ", " so ", " which ", " because ", " while "]) {
        const idx = s.indexOf(sp);
        if (idx > 18 && idx < s.length - 18) {
          const punc = s.match(/[.!?]+$/)?.[0] || ".";
          s = s.substring(0, idx).trim() + punc + " " + s.substring(idx + sp.length).trim().replace(/^./, c => c.toUpperCase());
          break;
        }
      }
    }

    if (Math.random() < 0.10 && i < sentences.length - 1) {
      const next = sentences[i + 1]?.trim();
      if (next && next.length < 45 && s.length < 65) {
        s = s.replace(/[.!?]+$/, "") + " — " + next.charAt(0).toLowerCase() + next.slice(1);
        i++;
      }
    }

    processed.push(s);
  }

  result = processed.join(" ");
  result = result.replace(/\s{2,}/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
  return result;
}

export const REFINE_PROMPT = `You just received a draft that feels slightly too polished and stiff. Your job is to rough it up and make it sound like a real person wrote it fast and naturally.

Specifically:
1. Pick 2-3 sentences that feel too clean and rewrite them to be messier — add a dash, a fragment, a self-correction, or a quick aside.
2. Find any sentence that starts with a capital word that sounds formal ("This system", "These tools", "Such methods") and rewrite the opener to be more casual.
3. Find at least one place to add a rhetorical question ("Why does that matter?" / "Sound familiar?" / "And honestly, who wouldn't?").
4. Make sure contractions are used wherever possible — no "do not", "it is", "they are" unless it's for emphasis.
5. Don't change the meaning. Don't change more than 30% of the sentences.

Output ONLY the refined text. No commentary.`;

export async function callOpenAI(prompt, text, temp = 0.9) {
  const API_KEY = process.env.FREEMODEL_API_KEY;
  const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.freemodel.dev/v1";
  const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const url = `${BASE_URL.replace(/\/+$/, "")}/chat/completions`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: prompt }, { role: "user", content: text }],
      temperature: temp,
      frequency_penalty: 0.9,
      presence_penalty: 0.8,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `OpenAI error ${r.status}`);
  return d?.choices?.[0]?.message?.content || "";
}
