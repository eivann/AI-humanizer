import http from "http";
import fs from "fs";
import path from "path";

// ─── Environment Loading ────────────────────────────────────────────────────
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, "utf8");
    envFile.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim().replace(/^['"]|['"]$/g, "");
        process.env[key] = val;
      }
    });
    console.log("✓ Loaded .env configuration");
  }
} catch (e) {
  console.warn("Could not read .env:", e);
}

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.FREEMODEL_API_KEY || "";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.freemodel.dev/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://cc.freemodel.dev/v1";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-t0";
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "15", 10);
const RATE_LIMIT_WINDOW = 60 * 1000;

// ─── Rate Limiter ───────────────────────────────────────────────────────────
const rateBuckets = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  if (!rateBuckets.has(ip)) {
    rateBuckets.set(ip, { count: 1, start: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  const b = rateBuckets.get(ip);
  if (now - b.start > RATE_LIMIT_WINDOW) {
    b.count = 1;
    b.start = now;
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  b.count++;
  if (b.count > RATE_LIMIT_MAX) {
    const retry = Math.ceil((b.start + RATE_LIMIT_WINDOW - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter: retry };
  }
  return { allowed: true, remaining: RATE_LIMIT_MAX - b.count };
}

// ─── Request Logger & Stats ─────────────────────────────────────────────────
const stats = {
  totalRequests: 0, success: 0, failed: 0,
  byProvider: {}, byType: {},
  wordsProcessed: 0, startedAt: new Date().toISOString(),
};
const recentLogs = [];

function logReq(ip, provider, type, words, ok) {
  const entry = { ts: new Date().toISOString(), ip, provider, type, words, ok };
  recentLogs.push(entry);
  if (recentLogs.length > 200) recentLogs.shift();
  stats.totalRequests++;
  ok ? stats.success++ : stats.failed++;
  stats.byProvider[provider] = (stats.byProvider[provider] || 0) + 1;
  stats.byType[type] = (stats.byType[type] || 0) + 1;
  stats.wordsProcessed += words;
  console.log(`[${entry.ts}] ${type.toUpperCase()} | ${provider} | ${words}w | ${ok ? "✓" : "✗"} | ${ip}`);
}

// ─── AI Call Utilities ──────────────────────────────────────────────────────
async function callOpenAI(prompt, text, temp = 0.9) {
  const url = `${OPENAI_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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

async function callAnthropic(prompt, text, temp = 0.9) {
  const url = `${ANTHROPIC_BASE_URL.replace(/\/+$/, "")}/messages`;
  const sys = `You are Claude Code, Anthropic's official CLI for Claude. ${prompt}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}`,
      "x-api-key": API_KEY, "anthropic-version": "2023-06-01",
      "User-Agent": "claude-code/0.2.16", "anthropic-client": "claude-code/0.2.16",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL, max_tokens: 4000, system: sys,
      messages: [{ role: "user", content: text }], temperature: temp,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `Anthropic error ${r.status}`);
  return d?.content?.[0]?.text || "";
}

function callAI(provider, prompt, text, temp = 0.9) {
  return provider === "anthropic" ? callAnthropic(prompt, text, temp) : callOpenAI(prompt, text, temp);
}

// ─── Streaming AI Calls ─────────────────────────────────────────────────────
async function streamOpenAI(prompt, text, res) {
  const url = `${OPENAI_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "system", content: prompt }, { role: "user", content: text }],
      temperature: 0.9, 
      stream: true,
      frequency_penalty: 0.9,
      presence_penalty: 0.8,
    }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error?.message || `OpenAI stream error ${r.status}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;
      try {
        const chunk = JSON.parse(raw);
        const t = chunk?.choices?.[0]?.delta?.content;
        if (t) { full += t; res.write(`data: ${JSON.stringify({ text: t })}\n\n`); }
      } catch (_) {}
    }
  }
  return full;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function getIP(req) { return req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown"; }
function wordCount(s) { return s.trim().split(/\s+/).filter(Boolean).length; }
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function jsonRes(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c.toString(); });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// ─── Post-Processing Pipeline ───────────────────────────────────────────────
// This is what professional humanizer tools actually do: transform the text
// at the token level AFTER the AI generates it, changing the statistical
// distribution that detectors analyze.

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

// Sentence starters that signal authentic human thought
const HUMAN_OPENERS = [
  "Look, ", "Honestly, ", "Here's the thing — ", "So basically, ",
  "The thing is, ", "I mean, ", "And honestly, ", "Truth is, ",
  "To be fair, ", "What's interesting is ", "The real story here is ",
];

// Em-dash interjections injected mid-sentence
const DASH_INTERJECTIONS = [
  "— and this is important —",
  "— which is actually pretty wild —",
  "— at least in most cases —",
  "— not that it's obvious —",
  "— though it depends —",
  "— worth keeping in mind —",
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function postProcess(text) {
  let result = text;

  // Step 1: Phrase-level synonym replacement (do phrases first to avoid partial word matches)
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

  // Step 2: Force contractions
  for (const [regex, replacement] of CONTRACTION_MAP) {
    result = result.replace(regex, replacement);
  }

  // Step 3: Sentence-level transformations
  const sentences = result.match(/[^.!?]+[.!?]+/g) || [result];
  const processed = [];

  for (let i = 0; i < sentences.length; i++) {
    let s = sentences[i].trim();
    if (!s) continue;

    // ~22% chance: inject a human sentence opener at the start
    if (Math.random() < 0.22 && !s.match(/^(Look|Honestly|So|I mean|Basically|The thing|Actually|Truth|To be fair|What'?s|And)/i)) {
      const opener = pick(HUMAN_OPENERS);
      s = opener + s.charAt(0).toLowerCase() + s.slice(1);
    }

    // ~18% chance: inject an informal marker inside a sentence at a comma
    if (Math.random() < 0.18 && s.includes(",")) {
      const commaIdx = s.indexOf(",");
      if (commaIdx > 8 && commaIdx < s.length - 12) {
        const marker = pick(INFORMAL_INSERTS);
        s = s.substring(0, commaIdx) + marker + s.substring(commaIdx + 1);
      }
    }

    // ~14% chance: inject an em-dash interjection after 4+ words
    if (Math.random() < 0.14) {
      const words = s.split(" ");
      if (words.length > 7) {
        const insertAt = Math.floor(words.length * 0.45);
        const interjection = pick(DASH_INTERJECTIONS);
        words.splice(insertAt, 0, interjection);
        s = words.join(" ");
      }
    }

    // ~15% chance: split a long sentence at a conjunction into two punchy ones
    if (Math.random() < 0.15 && s.length > 75) {
      const splitPoints = [" and ", " but ", " so ", " which ", " because ", " while "];
      for (const sp of splitPoints) {
        const idx = s.indexOf(sp);
        if (idx > 18 && idx < s.length - 18) {
          const first = s.substring(0, idx).trim();
          const second = s.substring(idx + sp.length).trim();
          const punc = s.match(/[.!?]+$/)?.[0] || ".";
          const secondCap = second.charAt(0).toUpperCase() + second.slice(1);
          s = first + punc + " " + secondCap;
          break;
        }
      }
    }

    // ~10% chance: merge with next short sentence using an em-dash
    if (Math.random() < 0.10 && i < sentences.length - 1) {
      const next = sentences[i + 1]?.trim();
      if (next && next.length < 45 && s.length < 65) {
        const cleanS = s.replace(/[.!?]+$/, "");
        s = cleanS + " — " + next.charAt(0).toLowerCase() + next.slice(1);
        i++;
      }
    }

    processed.push(s);
  }

  result = processed.join(" ");

  // Step 4: Paragraph-level restructuring — break up walls of uniform text
  // Split by double newlines (paragraphs) and vary their density
  const paragraphs = result.split(/\n{2,}/);
  if (paragraphs.length > 1) {
    const restructured = paragraphs.map((para) => {
      // ~20% chance: add a standalone punchy one-liner before this paragraph
      if (Math.random() < 0.20 && para.length > 100) {
        const punchLines = [
          "Here's why that matters.",
          "And that's not all.",
          "Think about it.",
          "Sounds simple, right? It's not.",
          "That changes everything.",
        ];
        return pick(punchLines) + "\n\n" + para;
      }
      return para;
    });
    result = restructured.join("\n\n");
  }

  // Step 5: Final cleanup
  result = result.replace(/\s{2,}/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();

  return result;
}

const REFINE_PROMPT = `You just received a draft written by an AI that was already edited once. It's decent but still has a slightly polished, artificial feel. Your job is to rough it up and make it sound like a real person wrote it fast.

Specifically:
1. Pick 2-3 sentences that feel too clean and rewrite them to be messier — add a dash, a fragment, a self-correction, or a quick aside.
2. Find any sentence that starts with a capital word that sounds formal ("This system", "These tools", "Such methods") and rewrite the opener to be more casual.
3. Find at least one place to add a rhetorical question ("Why does that matter?" / "Sound familiar?" / "And honestly, who wouldn't?").
4. Make sure contractions are used wherever possible — no "do not", "it is", "they are" unless it's for emphasis.
5. Don't change the meaning. Don't change more than 30% of the sentences.

Output ONLY the refined text. No commentary.`;

// ─── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const ip = getIP(req);

  try {
    // ── GET /api/stats ──
    if (req.method === "GET" && req.url === "/api/stats") {
      return jsonRes(res, 200, { ...stats, recentLogs: recentLogs.slice(-20), uptime: process.uptime() });
    }

    // ── POST /api/humanize (standard) ──
    if (req.method === "POST" && req.url === "/api/humanize") {
      const rl = checkRateLimit(ip);
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(rl.retryAfter));
        return jsonRes(res, 429, { error: { message: `Rate limit exceeded. Try again in ${rl.retryAfter}s.` } });
      }
      if (!API_KEY) return jsonRes(res, 500, { error: { message: "API key not configured." } });

      const { text, prompt, provider } = await readBody(req);
      if (!text || !prompt || !provider) return jsonRes(res, 400, { error: { message: "'text', 'prompt', 'provider' required." } });

      const wc = wordCount(text);
      const raw = await callAI(provider, prompt, text);
      const result = postProcess(raw);
      logReq(ip, provider, "standard", wc, true);
      return jsonRes(res, 200, { content: result });
    }

    // ── POST /api/humanize/stream (SSE streaming) ──
    if (req.method === "POST" && req.url === "/api/humanize/stream") {
      const rl = checkRateLimit(ip);
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(rl.retryAfter));
        return jsonRes(res, 429, { error: { message: `Rate limit exceeded. Try again in ${rl.retryAfter}s.` } });
      }
      if (!API_KEY) return jsonRes(res, 500, { error: { message: "API key not configured." } });

      const { text, prompt, provider } = await readBody(req);
      if (!text || !prompt || !provider) return jsonRes(res, 400, { error: { message: "'text', 'prompt', 'provider' required." } });

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });

      const wc = wordCount(text);
      try {
        // For post-processing, collect full text first then stream processed result
        let raw = "";
        if (provider === "openai") {
          raw = await callOpenAI(prompt, text);
        } else {
          raw = await callAnthropic(prompt, text);
        }
        const processed = postProcess(raw);
        // Stream the processed result word by word for a natural feel
        const words = processed.split(" ");
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? "" : " ") + words[i];
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        logReq(ip, provider, "stream", wc, true);
      } catch (err) {
        logReq(ip, provider, "stream", wc, false);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // ── POST /api/humanize/deep (multi-pass with SSE progress) ──
    if (req.method === "POST" && req.url === "/api/humanize/deep") {
      const rl = checkRateLimit(ip);
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(rl.retryAfter));
        return jsonRes(res, 429, { error: { message: `Rate limit exceeded. Try again in ${rl.retryAfter}s.` } });
      }
      if (!API_KEY) return jsonRes(res, 500, { error: { message: "API key not configured." } });

      const { text, prompt, provider } = await readBody(req);
      if (!text || !prompt || !provider) return jsonRes(res, 400, { error: { message: "'text', 'prompt', 'provider' required." } });

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });

      const wc = wordCount(text);
      try {
        // Pass 1: Initial humanization
        res.write(`data: ${JSON.stringify({ type: "progress", pass: 1, total: 3, status: "Humanizing original text..." })}\n\n`);
        const pass1 = await callAI(provider, prompt, text);
        res.write(`data: ${JSON.stringify({ type: "pass_result", pass: 1, text: postProcess(pass1) })}\n\n`);

        // Pass 2: Deep refinement via AI
        res.write(`data: ${JSON.stringify({ type: "progress", pass: 2, total: 3, status: "AI deep refinement pass..." })}\n\n`);
        const pass2 = await callAI(provider, REFINE_PROMPT, pass1);
        res.write(`data: ${JSON.stringify({ type: "pass_result", pass: 2, text: postProcess(pass2) })}\n\n`);

        // Pass 3: Statistical post-processing
        res.write(`data: ${JSON.stringify({ type: "progress", pass: 3, total: 3, status: "Statistical token transformation..." })}\n\n`);
        const final = postProcess(pass2);
        res.write(`data: ${JSON.stringify({ type: "pass_result", pass: 3, text: final })}\n\n`);

        res.write(`data: ${JSON.stringify({ type: "done", text: final })}\n\n`);
        logReq(ip, provider, "deep", wc, true);
      } catch (err) {
        logReq(ip, provider, "deep", wc, false);
        res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // ── POST /api/humanize/variations (3 parallel outputs) ──
    if (req.method === "POST" && req.url === "/api/humanize/variations") {
      const rl = checkRateLimit(ip);
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(rl.retryAfter));
        return jsonRes(res, 429, { error: { message: `Rate limit exceeded. Try again in ${rl.retryAfter}s.` } });
      }
      if (!API_KEY) return jsonRes(res, 500, { error: { message: "API key not configured." } });

      const { text, prompt, provider } = await readBody(req);
      if (!text || !prompt || !provider) return jsonRes(res, 400, { error: { message: "'text', 'prompt', 'provider' required." } });

      const wc = wordCount(text);
      try {
        const [r1, r2, r3] = await Promise.all([
          callAI(provider, prompt, text, 0.8),
          callAI(provider, prompt, text, 0.95),
          callAI(provider, prompt, text, 1.1),
        ]);
        logReq(ip, provider, "variations", wc, true);
        return jsonRes(res, 200, { variations: [postProcess(r1), postProcess(r2), postProcess(r3)] });
      } catch (err) {
        logReq(ip, provider, "variations", wc, false);
        return jsonRes(res, 500, { error: { message: err.message } });
      }
    }

    jsonRes(res, 404, { error: { message: "Not Found" } });
  } catch (err) {
    console.error("Server error:", err);
    jsonRes(res, 500, { error: { message: err.message || "Internal server error" } });
  }
});

server.listen(PORT, () => {
  console.log("═══════════════════════════════════════════════════════");
  console.log(`✨ Humanizer proxy running on http://localhost:${PORT}`);
  console.log("📡 Endpoints:");
  console.log("   POST /api/humanize          → Standard");
  console.log("   POST /api/humanize/stream    → Streaming SSE");
  console.log("   POST /api/humanize/deep      → Multi-pass (2x)");
  console.log("   POST /api/humanize/variations → 3 variations");
  console.log("   GET  /api/stats              → Usage dashboard");
  console.log(`🛡️  Rate limit: ${RATE_LIMIT_MAX} req/min per IP`);
  console.log("🔒 API key secured server-side");
  console.log("═══════════════════════════════════════════════════════");
});
