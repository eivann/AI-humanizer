# Lumen AI Humanizer — Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the four-phase optimization in `docs/superpowers/specs/2026-06-02-project-optimization-design.md` — dead-code purge, dependency cull, backend consolidation, humanizer pipeline rework.

**Architecture:** React + Vite + Tailwind frontend in `src/app/`, Vercel serverless functions in `api/humanize/*` sharing logic via `api/_lib/helpers.js`. Single OpenAI-compatible provider (`api.freemodel.dev`). No persistent backend state, no test suite.

**Tech Stack:** Node ESM, React 18, Vite 6, Tailwind 4, Vercel functions, OpenAI-compatible HTTP.

**No automated test suite exists.** Verification per task is concrete and manual: `pnpm build` success, repo-wide `grep` checks, `vercel dev` (or `npx vercel dev`) end-to-end smoke tests via browser + `curl`. Engineers should run a smoke pass at every commit point in this plan.

**Phase ordering:** 1 → 2 → 3 → 4. Each phase is independently committable and revertible.

---

## File Structure Overview

**Phase 1 — Delete / consolidate**
- DELETE `server.js` (legacy local HTTP server, ~600 lines, replaced by serverless functions)
- DELETE `api/humanize.js` (re-export shim that creates a Vercel folder/file routing conflict)
- MODIFY `package.json` (drop `server`, `start` scripts that point to deleted `server.js`)

**Phase 2 — Dependency cull**
- DELETE `src/app/components/` (entire directory of unreferenced shadcn UI + Figma asset components)
- MODIFY `package.json` (drop 40+ unused deps, flatten `peerDependencies` block into `dependencies`)

**Phase 3 — Backend consolidation**
- MODIFY `api/_lib/helpers.js` (add `MAX_CHARS`, `validateHumanizeBody`, `withApiGuards`)
- MODIFY `api/humanize/index.js` (use new guards + validator, drop `skipPostProcess` branch)
- MODIFY `api/humanize/deep.js` (use new guards + validator)
- MODIFY `api/humanize/variations.js` (use new guards + validator)
- DELETE `api/humanize/stream.js` (fake word-by-word streaming; Standard mode switches to JSON)
- MODIFY `src/app/App.tsx` (drop `provider`, drop frontend `REFINE_PROMPT`, Standard → JSON `/api/humanize`, Deep → SSE `/api/humanize/deep`)

**Phase 4 — Output quality**
- MODIFY `api/_lib/helpers.js` (add `FLUENCY_OPTIONS`, `TONE_OPTIONS`, `buildSystemPrompt`; rework `postProcess` with pre-compiled regexes, seeded RNG, burstiness pass, tuned opener frequency; sharpen `REFINE_PROMPT`; extend validator to accept `{ fluency, tone }` shape)
- MODIFY `api/humanize/index.js`, `deep.js`, `variations.js` (read `{ fluency, tone }` instead of `prompt`, call server-side `buildSystemPrompt`)
- MODIFY `src/app/App.tsx` (delete client-side `buildSystemPrompt`, send `{ text, fluency, tone }`)

---

# PHASE 1 — Dead code & duplication purge

## Task 1.1: Delete legacy `server.js`

**Files:**
- Delete: `server.js`

- [ ] **Step 1: Confirm nothing imports `server.js`**

Run: `grep -rn "server\.js" --include="*.{js,ts,tsx,json,yaml,yml,md}" . | grep -v node_modules | grep -v docs/superpowers`

Expected output: only `package.json` lines (`"server": "node server.js"`, `"start": "node server.js"`). Nothing else.

- [ ] **Step 2: Delete the file**

Run: `rm server.js`

- [ ] **Step 3: Verify build is unaffected**

Run: `pnpm build`

Expected: exits 0, produces `dist/` with assets.

## Task 1.2: Remove `server` and `start` scripts from `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit `package.json`** — remove the two dead scripts

Current `scripts` block:
```json
"scripts": {
  "build": "vite build",
  "dev": "vite",
  "server": "node server.js",
  "start": "node server.js"
},
```

Replace with:
```json
"scripts": {
  "build": "vite build",
  "dev": "vite"
},
```

- [ ] **Step 2: Verify scripts**

Run: `pnpm run`

Expected: `dev` and `build` listed; `server` and `start` absent.

## Task 1.3: Delete `api/humanize.js` shim

This file exists only to dodge a Vercel routing conflict between `api/humanize.js` and `api/humanize/index.js`. Deleting it lets the folder route (`api/humanize/index.js`) win cleanly.

**Files:**
- Delete: `api/humanize.js`

- [ ] **Step 1: Confirm the shim is not imported anywhere else**

Run: `grep -rn "from.*api/humanize\b" --include="*.{js,ts,tsx}" . | grep -v node_modules`

Expected: only the line inside `api/humanize.js` itself (`import handler from "./humanize/index.js"`). Nothing else.

- [ ] **Step 2: Delete the file**

Run: `rm api/humanize.js`

- [ ] **Step 3: Verify routing still resolves**

Run: `pnpm dlx vercel dev --listen 3001` in one terminal (or `npx vercel dev` if `pnpm dlx` is unavailable).

In another terminal:
```bash
curl -s -X POST http://localhost:3001/api/humanize \
  -H "Content-Type: application/json" \
  -d '{"text":"This utilizes a comprehensive approach.","prompt":"Rewrite casually."}' \
  | head -c 500
```

Expected: a JSON response with `{"content": "..."}` (assuming `FREEMODEL_API_KEY` is set in `.env`). If you see `{"error":{"message":"API key not configured."}}`, that's still proof that the route resolved — fine for this verification. If you see a 404 or HTML, routing is broken.

Stop `vercel dev` once verified.

## Task 1.4: Confirm `pnpm-workspace.yaml` is load-bearing (keep it)

**Files:**
- Inspect only.

- [ ] **Step 1: Read the file and confirm it has functional config**

Run: `cat pnpm-workspace.yaml`

Expected: contains `allowBuilds:` block controlling which packages run install scripts (`@tailwindcss/oxide`, `esbuild`).

- [ ] **Step 2: Note the decision**

This file stays. The spec's "(Confirm no internal references before deletion.)" caveat covers exactly this case: `allowBuilds` is the internal reference. No action.

## Task 1.5: Commit Phase 1

- [ ] **Step 1: Stage and commit**

```bash
git add -u server.js api/humanize.js package.json
git commit -m "$(cat <<'EOF'
Remove dead code: legacy server.js and humanize.js routing shim

Drop server.js (replaced by Vercel serverless functions), the
api/humanize.js shim (resolves routing conflict in favor of the
folder route), and the package.json scripts that pointed to the
deleted server.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify clean tree**

Run: `git status`

Expected: nothing modified for Phase 1 paths.

---

# PHASE 2 — Dependency cull

## Task 2.1: Delete the unreferenced `src/app/components/` directory

**Files:**
- Delete: `src/app/components/` (entire directory — 47 shadcn UI components + `figma/ImageWithFallback.tsx`)

- [ ] **Step 1: Final confirmation that nothing imports from `src/app/components/`**

Run: `grep -rn "from ['\"].*components/" --include="*.{tsx,ts}" src/ | grep -v "src/app/components/"`

Expected: no output. (Imports *inside* `src/app/components/` will be deleted along with the directory; those don't matter.)

Also run: `grep -rn "@/app/components" --include="*.{tsx,ts}" src/`

Expected: no output.

- [ ] **Step 2: Delete the directory**

Run: `rm -rf src/app/components`

- [ ] **Step 3: Verify build still succeeds**

Run: `pnpm build`

Expected: exits 0. No errors about missing modules.

## Task 2.2: Prune `package.json` dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace the entire `package.json` with the pruned version**

Final `package.json`:

```json
{
  "name": "lumen-ai-humanizer",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite"
  },
  "dependencies": {
    "lucide-react": "0.487.0",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "sonner": "2.0.3"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.1.12",
    "@vitejs/plugin-react": "4.7.0",
    "tailwindcss": "4.1.12",
    "vite": "6.3.5"
  },
  "pnpm": {
    "overrides": {
      "vite": "6.3.5"
    }
  }
}
```

Notes on what changed beyond the dep list:
- `name` changed from `@figma/my-make-file` to `lumen-ai-humanizer` (cosmetic; reflects the actual project).
- `peerDependencies` + `peerDependenciesMeta` blocks removed; `react` and `react-dom` moved into `dependencies` (this is an app, not a library — peers were wrong).
- `pnpm.overrides` kept.

- [ ] **Step 2: Reinstall**

Run: `pnpm install`

Expected: lockfile rewritten, removed packages disappear from `node_modules`. Should complete without warnings about missing deps.

- [ ] **Step 3: Repo-wide straggler check**

Run:
```bash
grep -rn "from ['\"]\(@radix-ui\|@mui\|@emotion\|@popperjs\|canvas-confetti\|class-variance-authority\|clsx\|cmdk\|date-fns\|embla-carousel\|input-otp\|motion\|next-themes\|react-day-picker\|react-dnd\|react-hook-form\|react-popper\|react-resizable-panels\|react-responsive-masonry\|react-router\|react-slick\|recharts\|tailwind-merge\|tw-animate-css\|vaul\)" --include="*.{ts,tsx,js,jsx}" src/ api/ 2>/dev/null
```

Expected: no output. If anything appears, it means a removed dep is still referenced — restore that dep to `package.json` OR delete the consuming file before continuing.

- [ ] **Step 4: Build verification**

Run: `pnpm build`

Expected: exits 0, `dist/` produced, bundle size dramatically smaller than before (compare to a previous build if available).

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`

In browser at `http://localhost:5173`: page renders, input/output panels visible, Mode/Fluency/Tone toggle groups work, no console errors. Stop dev server.

## Task 2.3: Commit Phase 2

- [ ] **Step 1: Stage and commit**

```bash
git add -u package.json pnpm-lock.yaml src/app/components
git commit -m "$(cat <<'EOF'
Cull unused dependencies and dead UI components

Remove the entire src/app/components/ tree (shadcn UI library
from the Figma export, never imported by App.tsx) and the 40+
package.json entries that backed it (MUI, Radix, react-dnd,
recharts, etc.). Move react and react-dom from peerDependencies
into dependencies — this is an app, not a library.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify clean tree**

Run: `git status`

Expected: clean.

---

# PHASE 3 — Backend consolidation

## Task 3.1: Add `MAX_CHARS`, `validateHumanizeBody`, `withApiGuards` to `api/_lib/helpers.js`

**Files:**
- Modify: `api/_lib/helpers.js`

- [ ] **Step 1: Append the new exports near the top of the file (above `pick`)**

Open `api/_lib/helpers.js`. After the existing constant blocks (`SYNONYM_MAP`, `CONTRACTION_MAP`, `INFORMAL_INSERTS`, `HUMAN_OPENERS`, `DASH_INTERJECTIONS`) and before `export function pick(arr)`, insert:

```js
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
```

Note: `setCors` is defined further down in the same file. Since this is a module-load-time function declaration that closes over `setCors` at call time (not at definition time), the forward reference is fine in ESM. If your editor complains, move `setCors` above `withApiGuards` (cosmetic only).

- [ ] **Step 2: Verify the file parses**

Run: `node --check api/_lib/helpers.js`

Expected: no output, exit 0.

## Task 3.2: Refactor `api/humanize/index.js` to use guards + validator

**Files:**
- Modify: `api/humanize/index.js`

- [ ] **Step 1: Replace the entire file**

```js
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
```

Notes on what changed:
- All CORS/OPTIONS/method/API-key boilerplate removed (now in `withApiGuards`).
- `skipPostProcess` branch deleted — only Deep mode used it, and Deep mode is moving to its own endpoint in Task 3.6.
- Validator runs inside `withApiGuards`, so `text` and `prompt` are guaranteed present and well-formed when `humanize` is called.

- [ ] **Step 2: Verify parse**

Run: `node --check api/humanize/index.js`

Expected: no output, exit 0.

## Task 3.3: Refactor `api/humanize/deep.js` to use guards + validator

**Files:**
- Modify: `api/humanize/deep.js`

- [ ] **Step 1: Replace the entire file**

```js
import { withApiGuards, callOpenAI, postProcess, REFINE_PROMPT } from "../_lib/helpers.js";

export const config = { maxDuration: 60 };

async function deep(req, res) {
  const { text, prompt } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

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

export default withApiGuards(deep);
```

- [ ] **Step 2: Verify parse**

Run: `node --check api/humanize/deep.js`

Expected: no output, exit 0.

## Task 3.4: Refactor `api/humanize/variations.js` to use guards + validator

**Files:**
- Modify: `api/humanize/variations.js`

- [ ] **Step 1: Replace the entire file**

```js
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
```

- [ ] **Step 2: Verify parse**

Run: `node --check api/humanize/variations.js`

Expected: no output, exit 0.

## Task 3.5: Delete `api/humanize/stream.js`

The fake word-by-word SSE on `/api/humanize/stream` waits for the full OpenAI response before sending any bytes. Removing it; Standard mode will use the JSON `/api/humanize` endpoint with a UI shimmer during the wait.

**Files:**
- Delete: `api/humanize/stream.js`

- [ ] **Step 1: Delete**

Run: `rm api/humanize/stream.js`

- [ ] **Step 2: Confirm nothing else references it**

Run: `grep -rn "/api/humanize/stream\|humanize/stream" --include="*.{ts,tsx,js,jsx,md}" src/ api/ 2>/dev/null`

Expected: matches only in `src/app/App.tsx` (which will be updated in Task 3.6).

## Task 3.6: Update `src/app/App.tsx` — drop `provider`, drop `REFINE_PROMPT`, Standard → JSON, Deep → SSE

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Delete the frontend `REFINE_PROMPT` constant**

Remove lines 67–76 of `App.tsx` (the block beginning with `const REFINE_PROMPT = \`You just received a draft...\`` through its closing backtick + semicolon). The Deep mode now calls the server-side endpoint, which already has its own copy in `api/_lib/helpers.js`.

- [ ] **Step 2: Delete the `providerCode` constant**

Find this line inside the `App` component (currently at line 101):

```tsx
const providerCode = "openai";
```

Delete it.

- [ ] **Step 3: Replace `handleStandard` to use JSON `/api/humanize` instead of SSE `/api/humanize/stream`**

Replace the entire `handleStandard` callback (currently lines 124–142):

```tsx
const handleStandard = useCallback(async () => {
  setOutput("");
  const res = await fetch(`${API_BASE}/api/humanize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: input, prompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.content) throw new Error("Empty response from the humanizer engine.");
  setOutput(data.content);
}, [input, prompt]);
```

Note: removed `provider`, removed SSE reader, removed dep on `readSSE` and `providerCode`.

- [ ] **Step 4: Replace `handleDeep` to use SSE `/api/humanize/deep` instead of two POSTs**

Replace the entire `handleDeep` callback (currently lines 144–182):

```tsx
const handleDeep = useCallback(async () => {
  setOutput("");
  setDeepProgress({ pass: 1, total: 3, status: "Humanizing original text..." });

  const res = await fetch(`${API_BASE}/api/humanize/deep`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: input, prompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  let finalText = "";
  await readSSE(res, (data) => {
    if (data.type === "progress") {
      setDeepProgress({ pass: data.pass, total: data.total, status: data.status });
    } else if (data.type === "pass_result") {
      setOutput(data.text);
    } else if (data.type === "done") {
      finalText = data.text;
      setOutput(data.text);
    } else if (data.type === "error") {
      throw new Error(data.message);
    }
  });

  setDeepProgress(null);
  if (!finalText) throw new Error("Deep humanization produced no output.");
}, [input, prompt, readSSE]);
```

- [ ] **Step 5: Update `handleVariations` to drop `provider` from payload**

Find `handleVariations` (currently lines 185–200). Change the `body` line from:

```tsx
body: JSON.stringify({ text: input, prompt, provider: providerCode }),
```

To:

```tsx
body: JSON.stringify({ text: input, prompt }),
```

And remove `providerCode` from the `useCallback` dependency array — the new deps line is:

```tsx
}, [input, prompt]);
```

- [ ] **Step 6: Build verification**

Run: `pnpm build`

Expected: exits 0. No TypeScript errors.

- [ ] **Step 7: End-to-end smoke test**

Run: `pnpm dlx vercel dev --listen 3001` in one terminal, `pnpm dev` in another (Vite will proxy `/api/*` to Vercel dev via the `API_BASE` constant pointing at port 3001 on localhost).

In browser:

1. Paste sample text into Original panel.
2. Click **Humanize** (Standard mode). Expected: shimmer skeleton appears, then full humanized text replaces it.
3. Switch to **Deep** mode, click **Deep Humanize**. Expected: progress bar advances 1/3 → 2/3 → 3/3 with status text changing; intermediate text appears during passes; final text settles.
4. Switch to **Variations** mode, click **Generate 3**. Expected: three tabs appear, each with different content. Switching tabs works.
5. Open browser DevTools Network tab — verify Standard mode calls `/api/humanize` (not `/api/humanize/stream`) and Deep mode calls `/api/humanize/deep` (one call, not two `/api/humanize` calls).

If any mode fails, do not commit — debug first.

- [ ] **Step 8: Input-length validation smoke test**

In the browser console (with the app loaded):

```js
fetch("/api/humanize", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "x".repeat(5001), prompt: "rewrite" }),
}).then(r => r.json()).then(console.log);
```

Expected: `{ error: { message: "'text' exceeds 5000 character limit." } }` and HTTP 413 (visible in Network tab).

## Task 3.7: Commit Phase 3

- [ ] **Step 1: Stage and commit**

```bash
git add -u api/ src/app/App.tsx
git commit -m "$(cat <<'EOF'
Consolidate backend: guards, validator, single Deep endpoint

Add withApiGuards + validateHumanizeBody to api/_lib/helpers.js
so every route shares CORS/OPTIONS/method/auth/validation logic.
Refactor humanize index/deep/variations to use them. Drop the
unused stream.js (fake word-by-word streaming) and the
skipPostProcess branch. Frontend Deep mode now hits the existing
SSE deep endpoint in one round-trip instead of two POSTs to
/api/humanize. Drop the unused provider field everywhere.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify clean tree**

Run: `git status`

Expected: clean.

---

# PHASE 4 — Output quality + post-processing

## Task 4.1: Add `FLUENCY_OPTIONS`, `TONE_OPTIONS`, `buildSystemPrompt`, line maps to `api/_lib/helpers.js`

**Files:**
- Modify: `api/_lib/helpers.js`

- [ ] **Step 1: Add the new exports near the existing `MAX_CHARS` block**

Add right after `MAX_CHARS`:

```js
export const FLUENCY_OPTIONS = ["Standard", "Academic", "Professional"];
export const TONE_OPTIONS = ["Conversational", "Confident", "Friendly", "Witty", "Empathetic"];

const FLUENCY_LINES = {
  Standard: "casual, like explaining something to a friend",
  Academic: "smart but informal, like a college student talking after class",
  Professional: "direct, no fluff, like a fast Slack message to a coworker",
};

const TONE_LINES = {
  Conversational: "laid back and chatty",
  Confident: "bold, opinionated, cuts to the chase",
  Friendly: "warm, approachable, a little enthusiastic",
  Witty: "sarcastic and sharp",
  Empathetic: "thoughtful and relatable",
};

export function buildSystemPrompt(fluency, tone) {
  const f = FLUENCY_LINES[fluency] || FLUENCY_LINES.Standard;
  const t = TONE_LINES[tone] || TONE_LINES.Conversational;
  return `You're a real person writing fast. Write the way you'd actually talk — uneven, off-the-cuff, sometimes fragmentary.

Voice: ${f}.
Energy: ${t}.

Rewrite the user's text in that voice. Don't add or remove meaning. Output only the rewrite.`;
}
```

- [ ] **Step 2: Update `validateHumanizeBody` to accept `{ text, fluency, tone }` instead of `{ text, prompt }`**

Replace the existing `validateHumanizeBody` (added in Task 3.1) with:

```js
export function validateHumanizeBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, message: "Request body must be a JSON object." };
  }
  const { text, fluency, tone } = body;
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, status: 400, message: "'text' is required and must be a non-empty string." };
  }
  if (text.length > MAX_CHARS) {
    return { ok: false, status: 413, message: `'text' exceeds ${MAX_CHARS} character limit.` };
  }
  if (!FLUENCY_OPTIONS.includes(fluency)) {
    return { ok: false, status: 400, message: `'fluency' must be one of: ${FLUENCY_OPTIONS.join(", ")}.` };
  }
  if (!TONE_OPTIONS.includes(tone)) {
    return { ok: false, status: 400, message: `'tone' must be one of: ${TONE_OPTIONS.join(", ")}.` };
  }
  return { ok: true };
}
```

- [ ] **Step 3: Sharpen `REFINE_PROMPT`**

Find the existing `export const REFINE_PROMPT = ...` block. Replace it with:

```js
export const REFINE_PROMPT = `The draft below is decent but its sentence openers are too uniform — every sentence starts with a noun phrase or a transitional adverb. That's an AI tell.

Rewrite only the sentence openers. Vary them aggressively: questions, fragments, mid-clause starts, conjunctions, interjections, single words. Keep the body of each sentence essentially unchanged. Don't touch more than 40% of sentences total.

Don't change the meaning. Output only the revised text.`;
```

- [ ] **Step 4: Verify parse**

Run: `node --check api/_lib/helpers.js`

Expected: exit 0.

## Task 4.2: Rework `postProcess` — pre-compiled regexes, seeded RNG, burstiness pass, tuned frequencies

**Files:**
- Modify: `api/_lib/helpers.js`

- [ ] **Step 1: Add a seeded RNG helper near the top of the file (above `pick`)**

```js
// Deterministic per-request PRNG. Same seed → same sequence.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

export function pickWith(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
```

Keep the existing `export function pick(arr)` for backward compatibility (no external consumers, but cheap to leave).

- [ ] **Step 2: Pre-compile regex tables at module load**

Below the existing `SYNONYM_MAP` / `CONTRACTION_MAP` declarations, add:

```js
const PRECOMPILED = (() => {
  const phrases = [];
  const words = [];
  for (const [k, v] of Object.entries(SYNONYM_MAP)) {
    if (k.includes(" ")) {
      phrases.push([new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), v]);
    } else {
      words.push([new RegExp(`\\b${k}\\b`, "gi"), v]);
    }
  }
  return { phrases, words };
})();
```

`CONTRACTION_MAP` entries are already `RegExp` literals in the source, so no precompilation needed there.

- [ ] **Step 3: Add the burstiness pass helper above `postProcess`**

```js
function applyBurstinessPass(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences || sentences.length < 3) return text;

  const lengths = sentences.map(s => s.trim().split(/\s+/).filter(Boolean).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / lengths.length;
  const stdev = Math.sqrt(variance);

  // Already bursty enough — leave it.
  if (stdev >= 0.45 * mean) return text;

  // Find longest sentence; try to split at a conjunction.
  let longestIdx = 0;
  for (let i = 1; i < lengths.length; i++) {
    if (lengths[i] > lengths[longestIdx]) longestIdx = i;
  }
  if (lengths[longestIdx] < 14) return text;

  const longest = sentences[longestIdx].trim();
  const punc = longest.match(/[.!?]+$/)?.[0] || ".";
  for (const sp of [" and ", " but ", " so ", " which ", " because "]) {
    const idx = longest.indexOf(sp);
    if (idx > 18 && idx < longest.length - 18) {
      const first = longest.substring(0, idx).trim() + punc;
      const rest = longest.substring(idx + sp.length).trim();
      sentences[longestIdx] = first + " " + rest.charAt(0).toUpperCase() + rest.slice(1);
      break;
    }
  }
  return sentences.join(" ");
}
```

- [ ] **Step 4: Replace `postProcess` with the seeded, tuned version**

Replace the entire existing `export function postProcess(text)` (lines ~113–184 in the current file). New version:

```js
export function postProcess(text, seed = Math.floor(Math.random() * 0xFFFFFFFF)) {
  const rng = mulberry32(seed);
  let result = text;

  // Step 1: phrase + word synonym replacement using pre-compiled regexes.
  for (const [re, alts] of PRECOMPILED.phrases) {
    result = result.replace(re, () => pickWith(rng, alts));
  }
  for (const [re, alts] of PRECOMPILED.words) {
    result = result.replace(re, () => pickWith(rng, alts));
  }

  // Step 2: force contractions.
  for (const [re, replacement] of CONTRACTION_MAP) {
    result = result.replace(re, replacement);
  }

  // Step 3: sentence-level transformations. Opener freq cut from 22% to 10%
  // and restricted to paragraph-initial positions.
  const paragraphs = result.split(/\n{2,}/);
  const processedParas = paragraphs.map((para) => {
    const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
    const processed = [];

    for (let i = 0; i < sentences.length; i++) {
      let s = sentences[i].trim();
      if (!s) continue;

      const isParaInitial = i === 0;

      // Opener: 10%, paragraph-initial only.
      if (isParaInitial && rng() < 0.10 &&
          !s.match(/^(Look|Honestly|So|I mean|Basically|The thing|Actually|Truth|To be fair|What'?s|And)/i)) {
        const opener = pickWith(rng, HUMAN_OPENERS);
        s = opener + s.charAt(0).toLowerCase() + s.slice(1);
      }

      // Mid-sentence informal insert at first comma. 18% (unchanged).
      if (rng() < 0.18 && s.includes(",")) {
        const commaIdx = s.indexOf(",");
        if (commaIdx > 8 && commaIdx < s.length - 12) {
          s = s.substring(0, commaIdx) + pickWith(rng, INFORMAL_INSERTS) + s.substring(commaIdx + 1);
        }
      }

      // Em-dash interjection. 14% (unchanged).
      if (rng() < 0.14) {
        const words = s.split(" ");
        if (words.length > 7) {
          words.splice(Math.floor(words.length * 0.45), 0, pickWith(rng, DASH_INTERJECTIONS));
          s = words.join(" ");
        }
      }

      // Sentence split on conjunction. 15% (unchanged).
      if (rng() < 0.15 && s.length > 75) {
        for (const sp of [" and ", " but ", " so ", " which ", " because ", " while "]) {
          const idx = s.indexOf(sp);
          if (idx > 18 && idx < s.length - 18) {
            const punc = s.match(/[.!?]+$/)?.[0] || ".";
            s = s.substring(0, idx).trim() + punc + " " +
                s.substring(idx + sp.length).trim().replace(/^./, c => c.toUpperCase());
            break;
          }
        }
      }

      // Merge with next short sentence using em-dash. 10% (unchanged).
      if (rng() < 0.10 && i < sentences.length - 1) {
        const next = sentences[i + 1]?.trim();
        if (next && next.length < 45 && s.length < 65) {
          s = s.replace(/[.!?]+$/, "") + " — " + next.charAt(0).toLowerCase() + next.slice(1);
          i++;
        }
      }

      processed.push(s);
    }
    return processed.join(" ");
  });

  // Step 4: paragraph-level punch line frequency cut from 20% to 10%.
  const withPunchLines = processedParas.map((para) => {
    if (rng() < 0.10 && para.length > 100) {
      const punchLines = [
        "Here's why that matters.",
        "And that's not all.",
        "Think about it.",
        "Sounds simple, right? It's not.",
        "That changes everything.",
      ];
      return pickWith(rng, punchLines) + "\n\n" + para;
    }
    return para;
  });

  result = withPunchLines.join("\n\n");

  // Step 5: burstiness pass.
  result = applyBurstinessPass(result);

  // Step 6: cleanup.
  result = result.replace(/\s{2,}/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
  return result;
}
```

- [ ] **Step 5: Verify parse**

Run: `node --check api/_lib/helpers.js`

Expected: exit 0.

- [ ] **Step 6: Quick deterministic sanity check**

Run:
```bash
node --input-type=module -e "
import('./api/_lib/helpers.js').then(m => {
  const txt = 'This system utilizes a comprehensive approach to facilitate efficient outcomes. It is important to note that these tools demonstrate significant value. Moreover, they leverage robust frameworks.';
  const a = m.postProcess(txt, 42);
  const b = m.postProcess(txt, 42);
  const c = m.postProcess(txt, 99);
  console.log('Same seed match:', a === b);
  console.log('Different seeds differ:', a !== c);
  console.log('Sample output:', a);
});
"
```

Expected:
- `Same seed match: true`
- `Different seeds differ: true`
- Sample output contains casual substitutions (`use` instead of `utilize`, contractions, etc.).

## Task 4.3: Update `index.js`, `deep.js`, `variations.js` to build the prompt server-side

**Files:**
- Modify: `api/humanize/index.js`
- Modify: `api/humanize/deep.js`
- Modify: `api/humanize/variations.js`

- [ ] **Step 1: Replace `api/humanize/index.js`**

```js
import { withApiGuards, callOpenAI, postProcess, buildSystemPrompt } from "../_lib/helpers.js";

async function humanize(req, res) {
  const { text, fluency, tone } = req.body;
  const prompt = buildSystemPrompt(fluency, tone);
  const seed = Math.floor(Math.random() * 0xFFFFFFFF);
  try {
    const raw = await callOpenAI(prompt, text);
    return res.status(200).json({ content: postProcess(raw, seed) });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Humanization failed." } });
  }
}

export default withApiGuards(humanize);
```

- [ ] **Step 2: Replace `api/humanize/deep.js`**

```js
import { withApiGuards, callOpenAI, postProcess, buildSystemPrompt, REFINE_PROMPT } from "../_lib/helpers.js";

export const config = { maxDuration: 60 };

async function deep(req, res) {
  const { text, fluency, tone } = req.body;
  const prompt = buildSystemPrompt(fluency, tone);
  const seed = Math.floor(Math.random() * 0xFFFFFFFF);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ type: "progress", pass: 1, total: 3, status: "Humanizing original text..." });
    const pass1 = await callOpenAI(prompt, text);
    send({ type: "pass_result", pass: 1, text: postProcess(pass1, seed) });

    send({ type: "progress", pass: 2, total: 3, status: "AI deep refinement pass..." });
    const pass2 = await callOpenAI(REFINE_PROMPT, pass1);
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
```

Note: same `seed` reused across both passes so the post-processing voice stays internally consistent.

- [ ] **Step 3: Replace `api/humanize/variations.js`**

```js
import { withApiGuards, callOpenAI, postProcess, buildSystemPrompt } from "../_lib/helpers.js";

export const config = { maxDuration: 60 };

async function variations(req, res) {
  const { text, fluency, tone } = req.body;
  const prompt = buildSystemPrompt(fluency, tone);
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
```

- [ ] **Step 4: Verify parses**

Run: `node --check api/humanize/index.js && node --check api/humanize/deep.js && node --check api/humanize/variations.js`

Expected: exit 0.

## Task 4.4: Update `src/app/App.tsx` — delete client-side prompt builder, send `{ fluency, tone }`

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Delete the client-side `buildSystemPrompt` function**

Remove lines 15–38 of `App.tsx` (the entire `const buildSystemPrompt = (fluency, tone) => { ... }` block). Keep the `FLUENCY_OPTIONS`, `TONE_OPTIONS`, `MODE_OPTIONS` arrays and their derived types — the UI still uses them for toggle groups.

- [ ] **Step 2: Delete the `prompt` derivation**

Inside the `App` component, find and delete:

```tsx
const prompt = buildSystemPrompt(fluency, tone);
```

- [ ] **Step 3: Update `handleStandard` payload and deps**

```tsx
const handleStandard = useCallback(async () => {
  setOutput("");
  const res = await fetch(`${API_BASE}/api/humanize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: input, fluency, tone }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.content) throw new Error("Empty response from the humanizer engine.");
  setOutput(data.content);
}, [input, fluency, tone]);
```

- [ ] **Step 4: Update `handleDeep` payload and deps**

In the `handleDeep` body, replace the `body:` line with:

```tsx
body: JSON.stringify({ text: input, fluency, tone }),
```

And update the dep array:

```tsx
}, [input, fluency, tone, readSSE]);
```

- [ ] **Step 5: Update `handleVariations` payload and deps**

```tsx
const handleVariations = useCallback(async () => {
  setVariations([]);
  setActiveVar(0);
  const res = await fetch(`${API_BASE}/api/humanize/variations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: input, fluency, tone }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.variations?.length) throw new Error("No variations returned.");
  setVariations(data.variations);
}, [input, fluency, tone]);
```

- [ ] **Step 6: Build verification**

Run: `pnpm build`

Expected: exit 0, no TS errors. If TS complains about unused imports, remove them.

- [ ] **Step 7: End-to-end smoke test**

Same as Task 3.6 Step 7 but with the new payload. Inspect Network tab — request bodies should now be `{"text":"...","fluency":"Standard","tone":"Conversational"}` (no `prompt`, no `provider`).

Run all three modes; verify all complete successfully. Toggle Fluency and Tone to confirm they still influence the output.

- [ ] **Step 8: Bad-input validation smoke**

```js
fetch("/api/humanize", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "test", fluency: "BadValue", tone: "Conversational" }),
}).then(r => r.json()).then(console.log);
```

Expected: `{ error: { message: "'fluency' must be one of: Standard, Academic, Professional." } }` and HTTP 400.

## Task 4.5: Commit Phase 4

- [ ] **Step 1: Stage and commit**

```bash
git add -u api/ src/app/App.tsx
git commit -m "$(cat <<'EOF'
Rework humanizer prompts and post-processing pipeline

Move prompt construction server-side as buildSystemPrompt(fluency,
tone) with a shorter voice-first directive. Pre-compile synonym
regexes at module load. Make postProcess deterministic per request
via a mulberry32 seeded RNG so variations are internally coherent
while differing from each other. Drop the human-opener frequency
from 22% to 10% and restrict to paragraph-initial sentences. Add
a final burstiness pass that splits the longest sentence on a
conjunction when sentence-length stdev is too low. Sharpen the
refine prompt to a single high-commitment transform (opener
variety). API request shape is now { text, fluency, tone }.

Note: changes are reasoned, not empirically validated. Bypass-rate
testing against detectors is the operator's responsibility.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Final verification**

Run: `git status && git log --oneline -10`

Expected: clean tree, four optimization commits visible (one per phase) on top of the design-spec commit.

---

## Self-review checklist (for the executing engineer)

After Phase 4, before declaring the work done:

1. **Bundle size:** Compare `dist/` size before (original `main`) and after (current branch). Expected: ~80–95% reduction.
2. **`node_modules` size:** Compare `du -sh node_modules` before/after. Expected: similar dramatic drop.
3. **All three modes still functional in a fresh browser session** (Standard, Deep, Variations).
4. **Network panel shows expected endpoints:** Standard → `/api/humanize`, Deep → `/api/humanize/deep`, Variations → `/api/humanize/variations`. No calls to `/api/humanize/stream` (deleted).
5. **Detector validation (optional, operator responsibility):** Run 3–5 sample inputs through GPTZero / Originality.ai before and after. Adjust opener/punchline frequencies in `postProcess` if results regressed — these are the easiest knobs to retune.
