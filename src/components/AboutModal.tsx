import React, { useState, useEffect } from "react";
import {
  X,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  Cpu,
  User,
  Bot,
  GitBranch,
  ChevronDown,
  ChevronUp,
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
  const [toolsAgentsExpanded, setToolsAgentsExpanded] = useState<boolean>(false);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl bg-[#141418] border border-[#27272a] rounded-2xl shadow-2xl shadow-black/90 flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
      >
        {/* Header */}
        <div className="relative p-5 pb-4 border-b border-[#27272a] bg-[#18181b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3.5 relative z-10">
            {/* App Logo Emblem */}
            <div className="w-11 h-11 rounded-xl bg-zinc-800 border border-zinc-700 p-0.5 shadow-md flex items-center justify-center shrink-0">
              <span className="text-lg font-black tracking-tighter text-zinc-100">
                xD
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="about-modal-title"
                  className="text-lg font-bold text-white tracking-tight"
                >
                  xDownloader
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                  v1.0.0
                </span>
              </div>
              <p className="text-xs text-[#a1a1aa] font-medium mt-0.5">
                Download video, musik, dan foto favoritmu dengan mudah
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-[#71717a] hover:text-white hover:bg-zinc-800 flex items-center justify-center cursor-pointer transition-colors relative z-10"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="overflow-y-auto p-5 space-y-5 text-sm text-[#d4d4d8] divide-y divide-[#1f1f23]">
          {/* 1. App Description (Chips removed) */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
              <span>Tentang Aplikasi</span>
            </h3>
            <p className="text-xs leading-relaxed text-[#a1a1aa]">
              <strong className="text-white font-semibold">xDownloader</strong> adalah aplikasi santai dan praktis buat unduh video, musik, dan foto berkualitas tinggi dari berbagai platform favorit seperti YouTube, TikTok, Instagram, X (Twitter), hingga Pinterest. Ringan, cepat, dan langsung tersimpan rapi di komputermu tanpa ribet.
            </p>
          </div>

          {/* 2. Collaborator (eggafx + Tools & Agents dropdown) */}
          <div className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-zinc-400" />
                <span>Collaborator</span>
              </h3>
            </div>

            {/* Main Collaborator Card: eggafx */}
            <div className="p-3.5 rounded-xl bg-[#0e0e11] border border-[#27272a] flex flex-col justify-between">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 font-extrabold text-sm shrink-0">
                  <User className="w-4 h-4 text-zinc-300" />
                </div>
                <div className="flex-grow min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-white text-sm tracking-tight">eggafx</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-200 border border-zinc-700">
                      Creator & Developer
                    </span>
                  </div>
                  <p className="text-[11px] text-[#a1a1aa] mt-1 leading-normal">
                    Kreator dan pengembang utama di balik pembuatan xDownloader.
                  </p>
                </div>
              </div>

              <div className="mt-2.5 pt-2.5 border-t border-[#1f1f23] flex items-center justify-between">
                <span className="text-[11px] text-[#71717a] font-mono">@eggafx</span>
                <button
                  onClick={() => handleOpenLink("https://github.com/eggafx")}
                  className="inline-flex items-center gap-1 text-xs text-zinc-300 hover:text-white font-semibold cursor-pointer transition-colors"
                >
                  <span>GitHub Profile</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Sub-part of Collaborator: Tools & Agents Dropdown */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setToolsAgentsExpanded(!toolsAgentsExpanded)}
                className="w-full flex items-center justify-between p-2.5 sm:p-3 rounded-xl bg-[#0e0e11] hover:bg-[#18181e] border border-[#27272a] hover:border-zinc-700 text-left transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300">
                    <Cpu className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white tracking-wide">
                        Tools & Agents
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300">
                        AI Agent
                      </span>
                    </div>
                    <p className="text-[11px] text-[#71717a] mt-0.5">
                      Partner AI yang ikut bantu ngoding dan kembangin aplikasi ini
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-zinc-400 group-hover:text-white transition-colors">
                  <span className="text-[11px] font-medium hidden sm:inline">
                    {toolsAgentsExpanded ? "Tutup" : "Lihat"}
                  </span>
                  {toolsAgentsExpanded ? (
                    <ChevronUp className="w-4 h-4 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-zinc-400" />
                  )}
                </div>
              </button>

              {/* Dropdown Content: AI Agent Only */}
              {toolsAgentsExpanded && (
                <div className="p-3.5 rounded-xl bg-[#0e0e11] border border-[#27272a] flex flex-col justify-between animate-in fade-in duration-150">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200">
                        AI Agent
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">Google DeepMind</span>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shrink-0">
                        <Bot className="w-4 h-4 text-zinc-300" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-white tracking-tight">Antigravity</h4>
                          <span className="text-[10px] text-zinc-400 font-mono">AI Partner</span>
                        </div>
                        <p className="text-[11px] text-[#a1a1aa] mt-1 leading-relaxed">
                          AI coding partner dari Google DeepMind yang diajak duet buat bantu ngoding, beresin fitur, dan jaga performa aplikasi.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-[#1f1f23] flex items-center justify-between text-[11px] text-zinc-500">
                    <span>Role: AI Coding Partner</span>
                    <span className="text-zinc-300 font-medium">AI Agent</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 4. Source Repository (xDownloader Only) */}
          <div className="pt-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
              <GithubIcon className="w-3.5 h-3.5 text-zinc-300" />
              <span>Source Repository</span>
            </h3>

            <div className="p-3.5 rounded-xl bg-[#0e0e11] border border-[#27272a] flex flex-col sm:flex-row sm:items-center justify-between gap-3 overflow-hidden">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shrink-0">
                  <GitBranch className="w-4 h-4 text-zinc-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white truncate">egga-fx/xdownloader</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 shrink-0">
                      main
                    </span>
                  </div>
                  <div className="text-[11px] text-[#71717a] truncate">
                    Repository resmi di GitHub. Terbuka buat dieksplorasi atau dikembangkan bareng!
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleCopy(REPO_URL, "xdownloader")}
                  className="h-7 px-2.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
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
                  className="h-7 px-2.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
                >
                  <span>View GitHub</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 px-5 border-t border-[#27272a] bg-[#141418] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-[#71717a]">
            Released under <span className="text-zinc-300 font-semibold">MIT License</span> · 2026
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold border border-zinc-700 cursor-pointer transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
