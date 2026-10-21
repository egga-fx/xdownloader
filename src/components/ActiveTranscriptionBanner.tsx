import React from "react";
import {
  Sparkles,
  CheckCircle2,
  Loader2,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { TranscriptionProgress, TranscriptionStage } from "../types";

interface ActiveTranscriptionBannerProps {
  transcription: TranscriptionProgress;
  title?: string;
  onOpenVault: () => void;
  onCancel: (taskId: string) => void;
}

const STAGES: { id: TranscriptionStage; label: string; step: number }[] = [
  { id: "downloading_audio", label: "Extract Audio", step: 1 },
  { id: "uploading", label: "Cloud Upload", step: 2 },
  { id: "transcribing", label: "AI Scribe v2", step: 3 },
  { id: "writing_files", label: "Save SRT", step: 4 },
];

function getStageIndex(stage: TranscriptionStage): number {
  switch (stage) {
    case "downloading_audio":
      return 0;
    case "uploading":
      return 1;
    case "transcribing":
      return 2;
    case "writing_files":
      return 3;
    case "completed":
      return 4;
    default:
      return 0;
  }
}

export const ActiveTranscriptionBanner: React.FC<ActiveTranscriptionBannerProps> = ({
  transcription,
  title,
  onOpenVault,
  onCancel,
}) => {
  const currentStageIdx = getStageIndex(transcription.stage);
  const percent = Math.min(Math.max(Math.round(transcription.percent), 0), 100);

  return (
    <div className="w-full bg-[#121216]/95 border border-purple-500/30 hover:border-purple-500/50 rounded-2xl p-4 sm:p-4.5 shadow-xl shadow-purple-950/20 backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-2">
      {/* Header Row: Badge, Title & Actions */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20">
                AI Transcription
              </span>
              <span className="text-xs font-mono font-bold text-white">
                {percent}%
              </span>
            </div>
            <p className="text-xs sm:text-sm font-bold text-white truncate mt-0.5" title={title || "Media"}>
              {title || "Auto Subtitle Transcript"}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenVault}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="View status in Media Vault"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Media Vault</span>
          </button>
          <button
            type="button"
            onClick={() => onCancel(transcription.taskId)}
            className="w-8 h-8 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors cursor-pointer"
            title="Cancel transcription process"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4-Step Visual Stepper */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {STAGES.map((s, idx) => {
          const isDone = currentStageIdx > idx;
          const isCurrent = currentStageIdx === idx;
          return (
            <div
              key={s.id}
              className={`flex flex-col gap-1 p-2 rounded-xl border text-[11px] transition-all ${
                isDone
                  ? "bg-purple-950/20 border-purple-500/30 text-purple-300"
                  : isCurrent
                  ? "bg-purple-500/15 border-purple-500/50 text-white shadow-sm shadow-purple-500/20 font-bold"
                  : "bg-zinc-900/40 border-zinc-800/60 text-zinc-500 font-medium"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-zinc-400">0{s.step}</span>
                {isDone ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
                ) : isCurrent ? (
                  <Loader2 className="w-3.5 h-3.5 text-purple-300 animate-spin" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                )}
              </div>
              <span className="truncate">{s.label}</span>
            </div>
          );
        })}
      </div>

      {/* Progress Bar & Realtime Message */}
      <div className="flex flex-col gap-1.5">
        <div className="w-full h-2 rounded-full bg-zinc-900 overflow-hidden border border-zinc-800">
          <div
            className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${Math.max(percent, 4)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5 truncate">
            <Loader2 className="w-3 h-3 text-purple-400 animate-spin shrink-0" />
            <span className="truncate">{transcription.message || "Processing audio transcript..."}</span>
          </span>
          <span className="font-mono text-purple-300 shrink-0 ml-2">
            ElevenLabs Scribe v2
          </span>
        </div>
      </div>
    </div>
  );
};
