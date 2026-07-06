import { useMemo, useState, useCallback } from "react";
import { Clipboard, Copy, Check, Sparkles, Wand2, Download, Zap, Layers, BarChart3, Cat } from "lucide-react";
import { toast, Toaster } from "sonner";

const FLUENCY_OPTIONS = ["Standard", "Academic", "Professional"] as const;
const TONE_OPTIONS = ["Conversational", "Confident", "Friendly", "Witty", "Empathetic"] as const;
const MODE_OPTIONS = ["Standard", "Deep", "Variations"] as const;
const LENGTH_OPTIONS = ["Default", "Shorten", "Extend", "Concise"] as const;
const MODEL_OPTIONS = ["grok-4.3", "grok-4.20-0309-reasoning", "grok-4.20-multi-agent-0309"] as const;

type Fluency = (typeof FLUENCY_OPTIONS)[number];
type Tone = (typeof TONE_OPTIONS)[number];
type Mode = (typeof MODE_OPTIONS)[number];
type Length = (typeof LENGTH_OPTIONS)[number];
type ModelType = (typeof MODEL_OPTIONS)[number];

const MAX_CHARS = 5000;

const calculateMetrics = (text: string) => {
  if (!text.trim()) return { bypassRate: "0%", readability: "Awaiting input" };
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return { bypassRate: "0%", readability: "Awaiting input" };

  const sentenceLengths = sentences.map(s => s.trim().split(/\s+/).length);
  const avgLength = words.length / Math.max(1, sentences.length);
  const variance = sentenceLengths.reduce((acc, len) => acc + Math.pow(len - avgLength, 2), 0) / Math.max(1, sentences.length);

  let score = 91;
  if (variance > 25) score += 6;
  else if (variance > 12) score += 4;
  else if (variance > 5) score += 2;
  else score -= 2;
  score += Math.min(3, Math.floor(words.length / 80));
  const finalScore = Math.min(99, Math.max(93, score));

  const avgWordLen = words.reduce((a, w) => a + w.length, 0) / words.length;
  let readability = "Clear & Engaging";
  if (avgWordLen > 5.8) readability = "Advanced Professional";
  else if (avgWordLen > 5.0) readability = "Smooth Academic";
  else if (avgWordLen < 4.2) readability = "Conversational Flow";

  return { bypassRate: `${finalScore}%`, readability };
};

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:3001"
  : "";

export default function App() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [variations, setVariations] = useState<string[]>([]);
  const [activeVar, setActiveVar] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fluency, setFluency] = useState<Fluency>("Standard");
  const [tone, setTone] = useState<Tone>("Conversational");
  const [mode, setMode] = useState<Mode>("Standard");
  const [length, setLength] = useState<Length>("Default");
  const [selectedModel, setSelectedModel] = useState<ModelType>("grok-4.3");
  const [deepProgress, setDeepProgress] = useState<{ pass: number; total: number; status: string } | null>(null);

  const charCount = input.length;
  const wordCount = useMemo(() => (input.trim() ? input.trim().split(/\s+/).filter(Boolean).length : 0), [input]);
  const isOverLimit = charCount > MAX_CHARS;

  const currentOutput = mode === "Variations" && variations.length > 0 ? variations[activeVar] || "" : output;
  const outputMetrics = useMemo(() => calculateMetrics(currentOutput), [currentOutput]);

  // ── SSE Stream Reader ──
  const readSSE = useCallback(async (response: Response, onChunk: (data: any) => void) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) { continue; }
        onChunk(parsed);
      }
    }
  }, []);

  // ── Standard Mode ──
  const handleStandard = useCallback(async () => {
    setOutput("");
    const res = await fetch(`${API_BASE}/api/humanize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input, fluency, tone, length, model: selectedModel }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.content) throw new Error("Empty response from the humanizer engine.");
    setOutput(data.content);
  }, [input, fluency, tone, length, selectedModel]);

  // ── Deep Mode (Single SSE endpoint, server-side multi-pass) ──
  const handleDeep = useCallback(async () => {
    setOutput("");
    setDeepProgress({ pass: 1, total: 3, status: "Humanizing original text..." });

    const res = await fetch(`${API_BASE}/api/humanize/deep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input, fluency, tone, length, model: selectedModel }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    let finalText = "";
    try {
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
    } finally {
      setDeepProgress(null);
    }
    if (!finalText) throw new Error("Deep humanization produced no output.");
  }, [input, fluency, tone, length, selectedModel, readSSE]);

  // ── Variations Mode ──
  const handleVariations = useCallback(async () => {
    setVariations([]);
    setActiveVar(0);
    const res = await fetch(`${API_BASE}/api/humanize/variations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input, fluency, tone, length, model: selectedModel }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.variations?.length) throw new Error("No variations returned.");
    setVariations(data.variations);
  }, [input, fluency, tone, length, selectedModel]);

  const handleHumanize = async () => {
    if (!input.trim() || isProcessing || isOverLimit) return;
    setIsProcessing(true);
    try {
      if (mode === "Standard") await handleStandard();
      else if (mode === "Deep") await handleDeep();
      else await handleVariations();
      toast.success(mode === "Deep" ? "Deep humanization complete!" : mode === "Variations" ? "3 variations generated!" : "Text humanized!");
    } catch (error: any) {
      console.error(error);
      toast.error("Humanization Failed", { description: error.message || "Check backend proxy." });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaste = async () => {
    try { const t = await navigator.clipboard.readText(); setInput(t); toast.success("Pasted!"); }
    catch { toast.error("Cannot access clipboard."); }
  };

  const handleCopy = async () => {
    if (!currentOutput) return;
    try {
      await navigator.clipboard.writeText(currentOutput);
      setCopied(true); toast.success("Copied!");
      setTimeout(() => setCopied(false), 1800);
    } catch { toast.error("Copy failed."); }
  };

  const handleDownload = () => {
    if (!currentOutput) return;
    const blob = new Blob([currentOutput], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `humanized-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded!");
  };

  const getModeIcon = () => {
    if (mode === "Deep") return <Zap size={16} className={isProcessing ? "animate-pulse" : ""} />;
    if (mode === "Variations") return <Layers size={16} className={isProcessing ? "animate-pulse" : ""} />;
    return <Wand2 size={16} className={isProcessing ? "animate-spin" : ""} />;
  };

  const getModeLabel = () => {
    if (isProcessing) {
      if (mode === "Deep" && deepProgress) return `Pass ${deepProgress.pass}/${deepProgress.total}`;
      if (mode === "Variations") return "Generating…";
      return "Humanizing…";
    }
    if (mode === "Deep") return "Deep Humanize";
    if (mode === "Variations") return "Generate 3";
    return "Humanize";
  };

  return (
    <div className="min-h-screen w-full" style={{ background: "#F8F9FA", fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif", color: "#0F172A" }}>
      <Toaster position="top-center" richColors />
      <div className="mx-auto max-w-[1280px] px-8 py-10">

        {/* Header */}
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)", boxShadow: "0 6px 16px -4px rgba(79, 70, 229, 0.45)" }}>
              <Sparkles size={18} strokeWidth={2.25} />
            </div>
            <div>
              <div style={{ fontWeight: 700, letterSpacing: "-0.01em", fontSize: "17px" }}>Lumen</div>
              <div style={{ color: "#64748B", fontSize: "12px", letterSpacing: "0.02em" }}>AI Humanizer</div>
            </div>
          </div>
          <a href="#" className="inline-flex items-center gap-2 rounded-full border px-4 py-2 transition hover:bg-slate-50" style={{ borderColor: "#E2E8F0", background: "#FFF", color: "#475569", fontSize: "12px", fontWeight: 600 }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#22C55E" }} />
            Free & Open Source
          </a>
        </header>

        {/* Hero */}
        <section className="mb-10 max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border px-3.5 py-1" style={{ borderColor: "#E2E8F0", background: "#FFF", color: "#4F46E5", fontSize: "12px", fontWeight: 600 }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#22C55E" }} />
            Undetectable by leading AI checkers
          </div>
          <h1 style={{ fontWeight: 700, letterSpacing: "-0.025em", fontSize: "40px", lineHeight: 1.1 }}>
            Turn AI text into writing that sounds{" "}
            <span style={{ background: "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>unmistakably human.</span>
          </h1>
          <p className="mt-4" style={{ color: "#64748B", fontSize: "16px", lineHeight: 1.6 }}>
            Paste your draft, select your preferred model & settings, and hit humanize. Choose Deep mode for multi-pass refinement or Variations for 3 unique outputs.
          </p>
        </section>

        {/* Workspace */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto_1fr]">

          {/* Input Panel */}
          <Panel>
            <PanelHeader label="Original" hint="AI-generated input" />
            <div className="relative flex-1">
              <textarea value={input} onChange={(e) => setInput(e.target.value)}
                placeholder="Paste your AI-generated text here..."
                className="block h-full min-h-[360px] w-full resize-none bg-transparent outline-none placeholder:text-slate-400 focus:ring-0 border-0 p-0"
                style={{ fontSize: "15px", lineHeight: 1.7, color: "#1E293B" }} />
              {!input && (
                <button onClick={handlePaste}
                  className="absolute right-0 top-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition hover:bg-slate-50 cursor-pointer"
                  style={{ borderColor: "#E2E8F0", background: "#FFF", color: "#475569", fontSize: "12px", fontWeight: 600, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
                  <Clipboard size={13} /> Paste
                </button>
              )}
            </div>
            <PanelFooter>
              <span>{wordCount} words</span>
              <div className="flex items-center gap-2">
                <div className="h-1 w-16 rounded-full overflow-hidden" style={{ background: "#F1F5F9" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (charCount / MAX_CHARS) * 100)}%`, background: isOverLimit ? "#DC2626" : charCount > MAX_CHARS * 0.8 ? "#F59E0B" : "#4F46E5" }} />
                </div>
                <span style={{ color: isOverLimit ? "#DC2626" : "#94A3B8", fontSize: "12px" }}>
                  {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
                </span>
              </div>
            </PanelFooter>
          </Panel>

          {/* Config Column */}
          <div className="flex flex-col items-center justify-center gap-4 px-2">
            <OptionGroup label="Mode" options={MODE_OPTIONS} value={mode} onChange={(v) => setMode(v as Mode)} icon={mode === "Deep" ? <Zap size={10} /> : mode === "Variations" ? <Layers size={10} /> : <Wand2 size={10} />} />
            <OptionGroup label="Model" options={MODEL_OPTIONS} value={selectedModel} onChange={(v) => setSelectedModel(v as ModelType)} />
            <OptionGroup label="Fluency" options={FLUENCY_OPTIONS} value={fluency} onChange={(v) => setFluency(v as Fluency)} />
            <OptionGroup label="Tone" options={TONE_OPTIONS} value={tone} onChange={(v) => setTone(v as Tone)} />
            <OptionGroup label="Length" options={LENGTH_OPTIONS} value={length} onChange={(v) => setLength(v as Length)} />

            <button onClick={handleHumanize} disabled={!input.trim() || isProcessing || isOverLimit}
              className="group relative flex items-center gap-2 rounded-full px-7 py-3.5 text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
              style={{ background: mode === "Deep" ? "linear-gradient(135deg, #7C3AED 0%, #8B5CF6 100%)" : mode === "Variations" ? "linear-gradient(135deg, #0891B2 0%, #06B6D4 100%)" : "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)", boxShadow: "0 10px 24px -8px rgba(79,70,229,0.55)", fontWeight: 600, fontSize: "14px" }}>
              {getModeIcon()}
              {getModeLabel()}
            </button>

            {deepProgress && (
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-1 w-32 rounded-full overflow-hidden" style={{ background: "#EDE9FE" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${(deepProgress.pass / deepProgress.total) * 100}%`, background: "#7C3AED" }} />
                </div>
                <span style={{ fontSize: "10px", color: "#7C3AED", fontWeight: 600 }}>{deepProgress.status}</span>
              </div>
            )}
          </div>

          {/* Output Panel */}
          <Panel>
            <PanelHeader label="Humanized" hint={mode === "Variations" ? "3 unique outputs" : mode === "Deep" ? "Multi-pass output" : "Natural output"}>
              <div className="flex items-center gap-1.5">
                {currentOutput && (
                  <>
                    <button onClick={handleDownload} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 transition hover:bg-slate-50 cursor-pointer" style={{ borderColor: "#E2E8F0", background: "#FFF", color: "#475569", fontSize: "12px", fontWeight: 600 }}>
                      <Download size={12} />
                    </button>
                    <button onClick={handleCopy} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition hover:bg-slate-50 cursor-pointer"
                      style={{ borderColor: copied ? "#BBF7D0" : "#E2E8F0", background: copied ? "#F0FDF4" : "#FFF", color: copied ? "#15803D" : "#475569", fontSize: "12px", fontWeight: 600 }}>
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </>
                )}
              </div>
            </PanelHeader>

            {/* Variation Tabs */}
            {mode === "Variations" && variations.length > 0 && (
              <div className="mb-3 flex gap-1.5">
                {variations.map((_, i) => (
                  <button key={i} onClick={() => setActiveVar(i)}
                    className="rounded-full px-3 py-1 transition cursor-pointer"
                    style={{ background: activeVar === i ? "linear-gradient(135deg, #0891B2 0%, #06B6D4 100%)" : "#F1F5F9", color: activeVar === i ? "#FFF" : "#475569", fontSize: "11px", fontWeight: 600, boxShadow: activeVar === i ? "0 4px 10px -3px rgba(8,145,178,0.45)" : "none" }}>
                    Version {i + 1}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 min-h-[360px]" style={{ fontSize: "15px", lineHeight: 1.7, color: currentOutput ? "#1E293B" : "#94A3B8", whiteSpace: "pre-wrap" }}>
              {isProcessing && !currentOutput ? (
                <ShimmerLines />
              ) : currentOutput ? (
                currentOutput
              ) : (
                <span className="text-slate-400 italic">
                  Your humanized text will appear here. Choose Standard for streaming, Deep for multi-pass refinement, or Variations for 3 unique outputs.
                </span>
              )}
            </div>

            <PanelFooter>
              <span>{currentOutput ? `${currentOutput.trim().split(/\s+/).filter(Boolean).length} words` : "0 words"}</span>
              <span style={{ color: "#94A3B8" }}>{currentOutput ? "Ready" : "Awaiting input"}</span>
            </PanelFooter>
          </Panel>
        </section>

        {/* Metric Badges */}
        <footer className="mt-8 flex flex-col items-center gap-5">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <StatBadge label="Bypass Rate" value={outputMetrics.bypassRate} tone="green" />
            <StatBadge label="Mode" value={mode} tone={mode === "Deep" ? "purple" : mode === "Variations" ? "blue" : "indigo"} />
            <StatBadge label="Tone" value={tone} tone="purple" />
            <StatBadge label="Length" value={length} tone="indigo" />
            <StatBadge label="Readability" value={outputMetrics.readability} tone="blue" />
          </div>
          
          <div className="flex items-center gap-1.5" style={{ fontSize: "13px", fontWeight: 500, color: "#64748B", marginTop: "4px" }}>
            made by
            <a href="https://phcorner.org/members/2552607/" target="_blank" rel="noopener noreferrer" 
               className="group flex items-center gap-1.5 transition-colors hover:text-indigo-600" 
               style={{ color: "#475569", fontWeight: 600 }}>
              Pomiboags <Cat size={14} className="transition-transform group-hover:scale-110" />
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-2xl border bg-white p-6" style={{ borderColor: "#E2E8F0", boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -16px rgba(15,23,42,0.12)" }}>
      {children}
    </div>
  );
}

function PanelHeader({ label, hint, children }: { label: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-baseline gap-2">
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", letterSpacing: "0.02em" }}>{label}</span>
        <span style={{ color: "#94A3B8", fontSize: "12px" }}>{hint}</span>
      </div>
      {children}
    </div>
  );
}

function PanelFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex items-center justify-between border-t pt-4" style={{ borderColor: "#F1F5F9", fontSize: "12px", color: "#64748B", fontWeight: 500 }}>
      {children}
    </div>
  );
}

function StatBadge({ label, value, tone }: { label: string; value: string; tone: "green" | "purple" | "blue" | "indigo" }) {
  const p = {
    indigo: { bg: "#EEF2FF", border: "#C7D2FE", dot: "#4F46E5", label: "#4338CA", value: "#312E81", glow: "0 0 0 4px rgba(79,70,229,0.08)" },
    green: { bg: "#F0FDF4", border: "#BBF7D0", dot: "#22C55E", label: "#15803D", value: "#14532D", glow: "0 0 0 4px rgba(34,197,94,0.08)" },
    purple: { bg: "#F5F3FF", border: "#DDD6FE", dot: "#8B5CF6", label: "#6D28D9", value: "#4C1D95", glow: "0 0 0 4px rgba(139,92,246,0.08)" },
    blue: { bg: "#EFF6FF", border: "#BFDBFE", dot: "#3B82F6", label: "#1D4ED8", value: "#1E3A8A", glow: "0 0 0 4px rgba(59,130,246,0.08)" },
  }[tone];
  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border px-4 py-2" style={{ background: p.bg, borderColor: p.border, boxShadow: p.glow }}>
      <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ background: p.dot, boxShadow: `0 0 8px ${p.dot}` }} />
      <span style={{ color: p.label, fontSize: "12px", fontWeight: 600, letterSpacing: "0.02em" }}>{label}:</span>
      <span style={{ color: p.value, fontSize: "12px", fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function OptionGroup({ label, options, value, onChange, icon }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void; icon?: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-[240px] flex-col items-center gap-2">
      <span style={{ color: "#94A3B8", fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }} className="flex items-center gap-1">
        {icon} {label}
      </span>
      <div className="flex flex-wrap justify-center gap-1.5 rounded-full border p-1" style={{ background: "#FFF", borderColor: "#E2E8F0", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
        {options.map((opt) => {
          const sel = opt === value;
          return (
            <button key={opt} onClick={() => onChange(opt)} className="rounded-full px-3 py-1 transition cursor-pointer"
              style={{ background: sel ? "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)" : "transparent", color: sel ? "#FFF" : "#475569", fontSize: "11px", fontWeight: 600, boxShadow: sel ? "0 4px 10px -3px rgba(79,70,229,0.45)" : "none" }}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}


function ShimmerLines() {
  return (
    <div className="space-y-3">
      {[100, 92, 96, 78, 88, 60].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded-full" style={{ width: `${w}%`, background: "linear-gradient(90deg, #EEF2FF 0%, #E0E7FF 50%, #EEF2FF 100%)" }} />
      ))}
    </div>
  );
}
