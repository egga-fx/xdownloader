import React, { useState, useEffect } from "react";
import {
  X,
  ExternalLink,
  Copy,
  Check,
  Code2,
  Sparkles,
  Cpu,
  Layers,
  ShieldCheck,
  User,
  Bot,
  Heart,
  GitBranch,
} from "lucide-react";
import { openExternalUrl } from "../lib/tauri-api";

const GithubIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
    />
  </svg>
);

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ open, onClose }) => {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(label);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleOpenLink = (url: string) => {
    openExternalUrl(url);
  };

  const REPO_URL = "https://github.com/egga-fx/xdownloader";
  const MONOREPO_URL = "https://github.com/egga-fx/xclips";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl bg-[#0e0e11] border border-[#27272a] rounded-2xl shadow-2xl shadow-black/90 flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
      >
        {/* Header with Aurora Banner */}
        <div className="relative p-6 pb-5 border-b border-[#1f1f23] bg-gradient-to-b from-[#18181e] to-[#0e0e11] flex items-start justify-between shrink-0 overflow-hidden">
          {/* Subtle Ambient Glow */}
          <div className="absolute top-0 left-1/4 -translate-y-1/2 w-72 h-36 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute top-0 right-1/4 -translate-y-1/2 w-72 h-36 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-center gap-4 relative z-10">
            {/* App Logo Emblem */}
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-600 to-cyan-500 p-0.5 shadow-lg shadow-blue-500/25 shrink-0 flex items-center justify-center">
              <div className="w-full h-full bg-[#09090b] rounded-[14px] flex items-center justify-center">
                <span className="text-xl font-black tracking-tighter bg-gradient-to-br from-white via-zinc-200 to-blue-400 bg-clip-text text-transparent">
                  xD
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <h2
                  id="about-modal-title"
                  className="text-xl font-extrabold text-white tracking-tight"
                >
                  xDownloader
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                  v1.0.0
                </span>
                <span className="hidden sm:inline px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Stable
                </span>
              </div>
              <p className="text-xs text-[#a1a1aa] font-medium mt-0.5">
                High-Performance Universal Media Studio & Downloader
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#71717a] hover:text-white hover:bg-[#27272a] flex items-center justify-center cursor-pointer transition-colors relative z-10"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="overflow-y-auto p-6 space-y-6 text-sm text-[#d4d4d8] divide-y divide-[#1f1f23]">
          {/* 1. App Description */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>About the Application</span>
            </h3>
            <p className="text-xs leading-relaxed text-[#a1a1aa]">
              <strong className="text-white font-semibold">xDownloader</strong> is a modern,
              local-first desktop media downloader and studio transcoder engineered for high-speed,
              lossless media extraction. Built with <span className="text-zinc-200 font-semibold">Tauri v2, Rust, and React 19</span>,
              it offers a seamless, zero-telemetry environment for downloading video, audio, and subtitles from
              major platforms including YouTube, TikTok, Instagram, X (Twitter), and Pinterest.
            </p>

            {/* Feature Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <div className="p-3 rounded-xl bg-[#141418] border border-[#27272a] flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-white">100% Local-First</div>
                  <div className="text-[11px] text-[#71717a]">Zero cloud upload & zero tracking</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#141418] border border-[#27272a] flex items-start gap-2.5">
                <Cpu className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-white">Native Dual-Engine</div>
                  <div className="text-[11px] text-[#71717a]">yt-dlp & FFmpeg hardware accelerated</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#141418] border border-[#27272a] flex items-start gap-2.5">
                <Layers className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-white">Smart Media Vault</div>
                  <div className="text-[11px] text-[#71717a]">Instant preview & SQLite WAL index</div>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Contributors Section */}
          <div className="pt-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-rose-400" />
              <span>Project Contributors</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* eggafx */}
              <div className="p-4 rounded-xl bg-[#141418] border border-[#27272a] hover:border-[#3f3f46] transition-all flex flex-col justify-between group">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-blue-500/30 flex items-center justify-center text-cyan-300 font-extrabold text-sm shrink-0">
                    <User className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-white text-sm tracking-tight">eggafx</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25">
                        Author & Architect
                      </span>
                    </div>
                    <p className="text-[11px] text-[#a1a1aa] mt-1 leading-normal">
                      Founder, Product Owner & Lead System Architect of xClips & xDownloader suite.
                    </p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-[#1f1f23] flex items-center justify-between">
                  <span className="text-[11px] text-[#71717a] font-mono">@eggafx</span>
                  <button
                    onClick={() => handleOpenLink("https://github.com/eggafx")}
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer transition-colors"
                  >
                    <span>GitHub Profile</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Antigravity */}
              <div className="p-4 rounded-xl bg-[#141418] border border-[#27272a] hover:border-[#3f3f46] transition-all flex flex-col justify-between group">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-extrabold text-sm shrink-0">
                    <Bot className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-white text-sm tracking-tight">Antigravity</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-400 border border-purple-500/25">
                        AI Co-Engineer
                      </span>
                    </div>
                    <p className="text-[11px] text-[#a1a1aa] mt-1 leading-normal">
                      Advanced Agentic Coding partner by Google DeepMind for full-stack engineering & QA.
                    </p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-[#1f1f23] flex items-center justify-between">
                  <span className="text-[11px] text-[#71717a] font-mono">DeepMind Agent</span>
                  <span className="text-[11px] text-purple-400 font-medium flex items-center gap-1">
                    <span>Pair Programming</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Git Repository Section */}
          <div className="pt-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
              <GithubIcon className="w-3.5 h-3.5 text-zinc-300" />
              <span>Source Repositories</span>
            </h3>

            <div className="space-y-2">
              {/* xDownloader Standalone */}
              <div className="p-3.5 rounded-xl bg-[#141418] border border-[#27272a] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#1e1e24] border border-[#2e2e36] flex items-center justify-center text-zinc-300 shrink-0">
                    <GitBranch className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">egga-fx/xdownloader</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        main
                      </span>
                    </div>
                    <div className="text-[11px] text-[#71717a] truncate max-w-sm">
                      Standalone desktop app repository with Tauri v2 bundle
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                  <button
                    onClick={() => handleCopy(REPO_URL, "xdownloader")}
                    className="h-7 px-2.5 rounded-md bg-[#1f1f23] hover:bg-[#27272a] text-[#a1a1aa] hover:text-white border border-[#2e2e36] text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="Copy Git clone URL"
                  >
                    {copiedUrl === "xdownloader" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleOpenLink(REPO_URL)}
                    className="h-7 px-2.5 rounded-md bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 border border-blue-500/30 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <span>View GitHub</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* xClips Parent Monorepo */}
              <div className="p-3.5 rounded-xl bg-[#141418] border border-[#27272a] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#1e1e24] border border-[#2e2e36] flex items-center justify-center text-zinc-300 shrink-0">
                    <Code2 className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">egga-fx/xclips</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        suite
                      </span>
                    </div>
                    <div className="text-[11px] text-[#71717a] truncate max-w-sm">
                      Smart Video Clipper & Short-Form Studio parent suite
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                  <button
                    onClick={() => handleCopy(MONOREPO_URL, "xclips")}
                    className="h-7 px-2.5 rounded-md bg-[#1f1f23] hover:bg-[#27272a] text-[#a1a1aa] hover:text-white border border-[#2e2e36] text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="Copy Git clone URL"
                  >
                    {copiedUrl === "xclips" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleOpenLink(MONOREPO_URL)}
                    className="h-7 px-2.5 rounded-md bg-[#1f1f23] hover:bg-[#27272a] text-[#a1a1aa] hover:text-white border border-[#2e2e36] text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <span>View Suite</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Tech Stack & Environment */}
          <div className="pt-5 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-zinc-400" />
              <span>Technology Stack</span>
            </h3>

            <div className="flex flex-wrap gap-1.5">
              {[
                "Tauri v2 (Rust 2021)",
                "React 19",
                "TypeScript strict",
                "Tailwind CSS v4",
                "yt-dlp",
                "FFmpeg & FFprobe",
                "SQLite WAL",
                "Masagi Zinc Dark",
              ].map((tech) => (
                <span
                  key={tech}
                  className="px-2.5 py-1 rounded-lg bg-[#141418] border border-[#27272a] text-[11px] font-medium text-[#a1a1aa]"
                >
                  {tech}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 px-6 border-t border-[#1f1f23] bg-[#0c0c0f] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-[#71717a]">
            Released under <span className="text-zinc-300 font-semibold">MIT License</span> · 2026
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#1f1f23] hover:bg-[#27272a] text-white text-xs font-bold border border-[#2e2e36] hover:border-[#3f3f46] cursor-pointer transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
