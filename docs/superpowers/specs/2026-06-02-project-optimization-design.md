# Lumen AI Humanizer — Project Optimization Design

**Date:** 2026-06-02
**Status:** Draft, awaiting user review
**Approach:** Option B (phased) with full output-quality overhaul

## Goal

Cut dead weight, consolidate sources of truth, simplify the API surface, and tighten the humanizer pipeline — without changing the user-visible feature set.

## Non-goals

- No new features (no auth, no accounts, no multi-provider routing, no observability stack).
- No empirical bypass-rate measurement. Output-quality changes are reasoned, not benchmarked. Validation against detectors is the user's responsibility post-merge.
- No rate limiting on the serverless functions (would require Upstash/Redis or similar; out of scope).

## Constraints

- Vercel serverless functions only on the backend; no persistent process, no in-memory state across requests.
- Vercel API routes cannot import from `src/` (different build root). Shared constants are duplicated as documented values, not via a shared module.
- Single OpenAI-compatible provider (`api.freemodel.dev`). The Anthropic path is dropped along with `server.js`.
- The existing `MAX_CHARS = 5000` limit stays.

---

## Phase 1 — Dead code & duplication purge

Zero behavior change. Pure deletion and consolidation.

### Delete

| Path | Reason |
|---|---|
| `server.js` | ~600 lines duplicating `api/_lib/helpers.js` + `api/humanize/*.js`. Not referenced by Vite or Vercel deploys. |
| `api/humanize.js` | Shim re-exporting `humanize/index.js` to dodge a Vercel folder/file routing conflict. Removing the file resolves the conflict in favor of the folder route. |
| `package.json` scripts: `server`, `start` | Point to deleted `server.js`. |
| `pnpm-workspace.yaml` | Single-package project; workspace config is noise. (Confirm no internal references before deletion.) |

### Consolidate

- `REFINE_PROMPT` currently lives in `server.js` (going away), `api/_lib/helpers.js`, and `src/app/App.tsx`. The frontend copy is only used by Deep mode, which Phase 3 moves server-side — so the frontend copy is deleted then. `api/_lib/helpers.js` becomes the sole source of truth.
- All AI calling, post-processing, and prompts live in `api/_lib/helpers.js`.

### Verification

- `pnpm build` succeeds.
- `vercel dev` (or `vc dev`) serves `/api/humanize`, `/api/humanize/stream`, `/api/humanize/deep`, `/api/humanize/variations` without 404s or routing warnings.
- App loads in browser and a Standard-mode humanization round-trips successfully.

---

## Phase 2 — Dependency cull

### Audit result

`App.tsx` imports only: `react`, `react-dom`, `lucide-react`, `sonner`.

Grep confirms **zero references** to `src/app/components/ui/*` or `src/app/components/figma/*` from anywhere in `src/`. The entire shadcn UI library shipped with the Figma export is dead code.

### Delete

- `src/app/components/` (entire directory — 47 unreferenced shadcn UI components plus `ImageWithFallback`).
- All of the following from `package.json` dependencies:
  - `@emotion/react`, `@emotion/styled`
  - `@mui/icons-material`, `@mui/material`
  - `@popperjs/core`, `react-popper`
  - All `@radix-ui/*` (28 packages)
  - `canvas-confetti`, `class-variance-authority`, `clsx`, `cmdk`, `date-fns`
  - `embla-carousel-react`, `input-otp`, `motion`, `next-themes`
  - `react-day-picker`, `react-dnd`, `react-dnd-html5-backend`
  - `react-hook-form`, `react-resizable-panels`, `react-responsive-masonry`
  - `react-router`, `react-slick`, `recharts`
  - `tailwind-merge`, `tw-animate-css`, `vaul`

### Keep

- `dependencies`: `react`, `react-dom`, `lucide-react`, `sonner`
- `devDependencies`: `@tailwindcss/vite`, `@vitejs/plugin-react`, `tailwindcss`, `vite`
- `peerDependencies` block: delete (`react`/`react-dom` move to `dependencies`).
- `peerDependenciesMeta` block: delete.
- `pnpm.overrides` for `vite`: keep (forces consistent Vite version).

### Verification

- Delete in this order: (1) `src/app/components/`, (2) `pnpm install` to ensure nothing else imports it, (3) prune `package.json`, (4) `pnpm install`, (5) `pnpm build`, (6) load app in dev and exercise Standard / Deep / Variations modes.
- Before final commit, grep the entire repo once more for any straggler imports of deleted packages.

---

## Phase 3 — Backend efficiency

### 3.1 Collapse Deep-mode round-trips

Currently: client POSTs to `/api/humanize` (pass 1 with `skipPostProcess: true`), receives JSON, then POSTs again to `/api/humanize` (pass 2 with refine prompt). Two serverless invocations, two cold-start risks, synthesized progress states in the UI.

Already exists server-side: `api/humanize/deep.js` runs both passes in one invocation and emits real SSE progress events. It is not currently called by the client.

**Change:** client's `handleDeep` becomes a single POST to `/api/humanize/deep` and consumes SSE via the existing `readSSE` helper. Emit progress UI from `type: "progress"` events, render intermediate text from `type: "pass_result"` events, finalize on `type: "done"`. Delete the `skipPostProcess` branch from `api/humanize/index.js` and the inlined `REFINE_PROMPT` from `App.tsx`.

### 3.2 Drop the unused `provider` field

Client sends `provider: "openai"`. All Vercel endpoints ignore it. Remove from client payloads and stop reading it server-side. Multi-provider support, if it returns, will be reintroduced intentionally.

### 3.3 Input validation at the boundary

In `api/_lib/helpers.js`, add a `validateHumanizeBody(body)` helper:

- `text` must be a non-empty string after trim
- `prompt` must be a non-empty string after trim
- `text.length` must be ≤ 5000 (matches the frontend `MAX_CHARS`)

Returns `{ ok: true }` or `{ ok: false, status, message }`. Each handler calls it once and short-circuits on failure with the returned status (400 for shape errors, 413 for length).

The `5000` constant is documented in `api/_lib/helpers.js` as `MAX_CHARS` and noted in a comment that the frontend constant must match. (No build-time sharing because of the Vercel/Vite split.)

### 3.4 Extract API guard wrapper

Each handler currently repeats: `setCors`, OPTIONS short-circuit, method check, API key check. Extract into `withApiGuards(handler, { methods: ["POST"] })` in `_lib/helpers.js`. Each route becomes:

```js
export default withApiGuards(async (req, res) => {
  // route-specific logic
}, { methods: ["POST"] });
```

Reduces each handler by ~10 lines and removes drift risk.

### 3.5 Drop fake streaming on `/api/humanize/stream`

Current behavior: server `await`s the entire OpenAI response, post-processes, then writes word-by-word over SSE. The user already waited the full latency before any byte arrived — the streaming is cosmetic.

**Change:** delete `api/humanize/stream.js`. The Standard-mode client switches to `/api/humanize` (plain JSON, no SSE). The Standard-mode UI keeps its shimmer skeleton during the wait, then renders the full result at once. Honest and ~30 lines lighter.

(True token-level streaming with on-the-fly post-processing is a viable alternative but out of scope for this pass — it would require a sentence-boundary streaming post-processor, which is non-trivial.)

### Verification

- Standard mode: input → click Humanize → spinner → output appears.
- Deep mode: input → click Deep Humanize → progress bar advances 1/3 → 2/3 → 3/3 with status text changing → final output appears.
- Variations mode: input → click Generate 3 → three variations render in tabs.
- Input over 5000 chars: clear 413 error toast.
- Input empty after trim: button disabled (existing UI) — no server roundtrip.

---

## Phase 4 — Output quality + post-processing

Reasoned changes. Not empirically validated. The user should test sample outputs against GPTZero / Originality.ai / Turnitin before relying on these changes for any specific bypass-rate claim.

### 4.1 Slim the system prompt

Current prompt (`buildSystemPrompt` in `App.tsx`) is ~700 chars of prescriptive rules: banned-word lists, mandatory contractions, sentence-style mandates. Two problems: (a) it spends model attention on rule compliance instead of voice, producing "humanness theater" that detectors are increasingly tuned to; (b) the deterministic enforcement (banned words → casual subs, contractions) is already handled in post-processing, so the prompt is duplicating work.

**Rewrite:** ~250-char voice-first prompt that names the speaker, the medium, and one micro-example showing the target register. Fluency/Tone dimensions still inflect a single line each — no rule enumeration. Move forbidden-word substitution entirely to post-processing.

The prompt lives in `api/_lib/helpers.js` as `buildSystemPrompt(fluency, tone)`. The frontend sends `{ fluency, tone }` instead of a pre-built prompt string. (This also keeps the prompt server-side, harder for end users to inspect.)

**API shape change.** This phase changes the request body across `/api/humanize`, `/api/humanize/deep`, and `/api/humanize/variations` from `{ text, prompt }` to `{ text, fluency, tone }`. The Phase 3.3 validator is updated correspondingly: `fluency` must be one of `FLUENCY_OPTIONS`, `tone` must be one of `TONE_OPTIONS` (both enumerated in `_lib/helpers.js`). `prompt` field is no longer accepted. Refine prompt (Deep mode pass 2) is also server-side already (lives in `_lib/helpers.js`) — no client change needed there.

### 4.2 Post-processing hardening

- **Pre-compile regexes at module load.** `SYNONYM_MAP` and `CONTRACTION_MAP` are currently iterated and `new RegExp(...)` is called per request. Build a single `precomputed = { phrases: [[regex, alts], ...], words: [[regex, alts], ...], contractions: [...] }` table at module init.
- **Per-request seeded RNG.** Replace `Math.random()` with a seeded PRNG (mulberry32 or similar) instantiated per `postProcess` call. Variations mode generates 3 outputs that should differ from each other but each be internally coherent — different seeds across variations, single seed within one. Deep mode's two passes use the same seed for the same request.
- **Sentence-burstiness target.** After current transformations, compute sentence-length stdev. If below threshold (e.g., `< 0.45 * mean`), apply one more split-or-merge pass biased toward whichever direction increases variance. Hard cap: don't run more than twice.
- **Dial down opener frequency.** "Look, " / "Honestly, " openers currently fire at 22% per sentence — on a 20-sentence output that's 4–5 inserts and itself becomes a detection signal. Drop to 10% AND restrict to paragraph-initial sentences only (first sentence after a `\n\n` or the document start).
- **Punch-line frequency** (the "Here's why that matters." standalone inserts at paragraph boundaries) drops from 20% to 10% for the same reason.

### 4.3 Sharpen REFINE_PROMPT

Current refine prompt asks for 5 things (sentence rewrites, opener softening, rhetorical question insertion, contractions, ≤30% changes). The model tends to do all five mildly. Better: pick the single highest-leverage transform — sentence-opener variety — and ask for it with high commitment. Keep the "don't change meaning" and "≤30% of sentences" guardrails.

### Verification

This phase has no automated verification beyond "the app still works." The user should:

1. Run before/after on 3–5 representative inputs.
2. Check each through their detector(s) of choice.
3. Decide whether to keep, tune, or revert specific changes.

---

## Out of scope (named for clarity, not action)

- **Rate limiting on Vercel functions.** Would need Upstash Redis or similar. Not addressed.
- **TypeScript on backend.** API files stay `.js`. Adding TS adds build complexity for marginal benefit at this scale.
- **Tests.** No test suite exists; adding one is its own project.
- **True token streaming with on-the-fly post-processing.** Sentence-boundary streaming is non-trivial; deferred.
- **Multi-provider routing (Anthropic path).** Dropped with `server.js`. Reintroduce intentionally if needed.
- **CORS tightening.** Stays `*`. Public app, no auth, no cookies.

## Risk register

| Risk | Mitigation |
|---|---|
| A removed dep is actually used somewhere I missed | Phase 2 verification includes repo-wide grep for each package name before final commit. |
| Vercel routing conflict resurfaces after `api/humanize.js` deletion | `vercel dev` smoke test before commit; rollback is a one-line git revert. |
| Deep mode SSE behaves differently from old 2-POST pattern | Existing `deep.js` already implemented and committed; smoke-tested end-to-end in Phase 3 verification. |
| Output-quality changes regress humanizer effectiveness | Stated as known risk; user owns empirical validation. Phase 4 is the last phase and easily revertible as one commit. |
| Frontend `MAX_CHARS` drifts from backend `MAX_CHARS` | Comment in `api/_lib/helpers.js` explicitly cross-references the frontend constant. Long-term fix (shared package) deferred. |

## Phase ordering rationale

1 → 2 → 3 → 4 is strictly low-risk to high-risk. Phases 1 and 2 are pure deletion with mechanical verification. Phase 3 changes API surface but each change has a small blast radius. Phase 4 is the only phase with subjective outcomes. Each phase ships as its own commit (or small commit series) so any single phase can be reverted without unwinding the others.
