import React, { useState, useEffect, useMemo } from "react";
import {
  Scissors,
  X,
  Clock,
  Plus,
  Trash2,
  HardDrive,
  Globe,
  Loader2,
  CheckCircle2,
  FolderOpen,
  AlertCircle,
  FileVideo,
  Layers,
  Zap,
} from "lucide-react";
import {
  SplitSegment,
  SplitterSource,
  VideoInfo,
  DownloaderQuality,
  SplitProgressEvent,
} from "../types";
import {
  formatDuration,
  secondsToTimestamp,
  timestampToSeconds,
  generatePresetSegments,
  detectPlatform,
  isSupportedMediaUrl,
  getErrorMessage,
} from "../lib/utils";
import {
  splitLocalVideo,
  splitStreamVideo,
  onSplitProgress,
  getVideoMetadata,
  openInExplorer,
} from "../lib/tauri-api";

interface VideoSplitterModalProps {
  open: boolean;
  onClose: () => void;
  source?: SplitterSource | null;
  outputFolder?: string;
  onSuccess?: () => void;
}

type SplitMode = "preset" | "custom";

const PRESET_DURATIONS = [
  { label: "15s (Stories)", sec: 15 },
  { label: "30s (TikTok / Reels)", sec: 30 },
  { label: "59s (Shorts)", sec: 59 },
  { label: "90s (Clips)", sec: 90 },
  { label: "120s (2 Min)", sec: 120 },
];

export const VideoSplitterModal: React.FC<VideoSplitterModalProps> = ({
  open,
  onClose,
  source,
  outputFolder,
  onSuccess,
}) => {
  // Mode selection
  const [splitMode, setSplitMode] = useState<SplitMode>("preset");
  const [selectedPresetSec, setSelectedPresetSec] = useState<number>(60);
  const [customChunkInput, setCustomChunkInput] = useState<string>("60");

  // Custom Segments
  const [customSegments, setCustomSegments] = useState<SplitSegment[]>([
    { partIndex: 1, start: "00:00:00", end: "00:01:00", label: "Part 1" },
    { partIndex: 2, start: "00:01:00", end: "00:02:00", label: "Part 2" },
  ]);

  // Options
  const [preciseCut, setPreciseCut] = useState<boolean>(false);
  const [createSubfolder, setCreateSubfolder] = useState<boolean>(true);
  const [streamQuality] = useState<DownloaderQuality>("1080p");
  const [streamFormat, setStreamFormat] = useState<"video" | "audio">("video");

  // Fallback source input if opened without source
  const [inputUrl, setInputUrl] = useState<string>("");
  const [fetchingInfo, setFetchingInfo] = useState<boolean>(false);
  const [fetchedInfo, setFetchedInfo] = useState<VideoInfo | null>(null);

  // Execution & Progress State
  const [splitting, setSplitting] = useState<boolean>(false);
  const [progressEvent, setProgressEvent] = useState<SplitProgressEvent | null>(null);
  const [completedParts, setCompletedParts] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Synchronize initial state when modal opens or source changes
  useEffect(() => {
    if (open) {
      setSplitting(false);
      setProgressEvent(null);
      setCompletedParts([]);
      setErrorMsg(null);

      if (source?.type === "online" && source.info) {
        setFetchedInfo(source.info);
        setInputUrl(source.url);
      } else if (source?.type === "online" && source.url) {
        setInputUrl(source.url);
        fetchUrlInfo(source.url);
      } else if (source?.type === "local") {
        setFetchedInfo(null);
      } else {
        setFetchedInfo(null);
        setInputUrl("");
      }
    }
  }, [open, source]);

  // Listen to Tauri backend split-progress events
  useEffect(() => {
    if (!open) return;
    const unlisten = onSplitProgress((event) => {
      setProgressEvent(event);
      if (event.status === "error" && event.error) {
        setErrorMsg(event.error);
        setSplitting(false);
      }
    });
    return () => {
      unlisten();
    };
  }, [open]);

  // Fetch online video metadata if needed
  const fetchUrlInfo = async (targetUrl: string) => {
    if (!targetUrl || !isSupportedMediaUrl(targetUrl)) return;
    setFetchingInfo(true);
    setErrorMsg(null);
    try {
      const info = await getVideoMetadata(targetUrl.trim());
      setFetchedInfo(info);
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err) || "Failed to fetch stream details");
    } finally {
      setFetchingInfo(false);
    }
  };

  // Derive target video metadata (Duration, Title, Thumbnail, Type)
  const videoDetails = useMemo(() => {
    if (source?.type === "local") {
      const dur = source.duration || (source.record?.durationSec ?? 0);
      return {
        type: "local" as const,
        title: source.title || source.record?.title || "Local Video",
        duration: dur,
        thumbnail: source.thumbnail || source.record?.thumbnailUrl,
        filePath: source.filePath || source.record?.filePath,
      };
    }

    const info = fetchedInfo || (source?.type === "online" ? source.info : undefined);
    return {
      type: "online" as const,
      title: info?.title || "Online Video Stream",
      duration: info?.duration || 0,
      thumbnail: info?.thumbnail,
      url: inputUrl || (source?.type === "online" ? source.url : ""),
      author: info?.uploader || info?.channel,
    };
  }, [source, fetchedInfo, inputUrl]);

  // Total Duration in seconds
  const totalDurationSec = videoDetails.duration;

  // Compute preset segments dynamically based on total duration & selected chunk
  const activePresetSegments: SplitSegment[] = useMemo(() => {
    const chunkSec =
      selectedPresetSec === -1
        ? Math.max(5, parseInt(customChunkInput, 10) || 60)
        : selectedPresetSec;

    const dur = totalDurationSec > 0 ? totalDurationSec : 300; // default 5m preview if unknown
    return generatePresetSegments(dur, chunkSec);
  }, [totalDurationSec, selectedPresetSec, customChunkInput]);

  // Effective Segments to Split
  const segmentsToProcess: SplitSegment[] = useMemo(() => {
    if (splitMode === "preset") {
      return activePresetSegments;
    }
    return customSegments.map((seg, idx) => ({
      ...seg,
      partIndex: idx + 1,
      label: seg.label || `Part ${idx + 1}`,
    }));
  }, [splitMode, activePresetSegments, customSegments]);

  // Handler: Add Custom Segment
  const handleAddCustomSegment = () => {
    const last = customSegments[customSegments.length - 1];
    let startTs = "00:00:00";
    let endTs = "00:01:00";

    if (last) {
      startTs = last.end;
      const startSec = timestampToSeconds(startTs);
      const nextEndSec = totalDurationSec > 0
        ? Math.min(startSec + 60, totalDurationSec)
        : startSec + 60;
      endTs = secondsToTimestamp(nextEndSec);
    }

    const nextIndex = customSegments.length + 1;
    setCustomSegments([
      ...customSegments,
      {
        partIndex: nextIndex,
        start: startTs,
        end: endTs,
        label: `Part ${nextIndex}`,
      },
    ]);
  };

  // Handler: Remove Custom Segment
  const handleRemoveCustomSegment = (index: number) => {
    if (customSegments.length <= 1) return;
    setCustomSegments(customSegments.filter((_, i) => i !== index));
  };

  // Handler: Update Custom Segment
  const handleUpdateCustomSegment = (
    index: number,
    field: "start" | "end" | "label",
    value: string
  ) => {
    const updated = [...customSegments];
    updated[index] = { ...updated[index], [field]: value };
    setCustomSegments(updated);
  };

  // Handler: Execute Split
  const handleStartSplit = async () => {
    if (segmentsToProcess.length === 0) {
      setErrorMsg("No segments specified to split.");
      return;
    }

    setSplitting(true);
    setErrorMsg(null);
    setProgressEvent({
      partIndex: 1,
      totalParts: segmentsToProcess.length,
      percent: 0,
      status: "starting",
      title: "Initializing splitter engine...",
    });

    try {
      if (videoDetails.type === "local") {
        if (!videoDetails.filePath) {
          throw new Error("Local file path is missing or file does not exist on disk.");
        }
        const createdFiles = await splitLocalVideo({
          filePath: videoDetails.filePath,
          segments: segmentsToProcess,
          outputFolder,
          preciseCut,
          createSubfolder,
        });
        setCompletedParts(createdFiles);
      } else {
        const streamUrl = videoDetails.url;
        if (!streamUrl) {
          throw new Error("Please provide a valid video URL.");
        }
        const createdFiles = await splitStreamVideo({
          url: streamUrl,
          segments: segmentsToProcess,
          formatType: streamFormat,
          quality: streamQuality,
          title: videoDetails.title,
          thumbnailUrl: videoDetails.thumbnail,
          author: videoDetails.author,
          outputFolder,
          createSubfolder,
        });
        setCompletedParts(createdFiles);
      }

      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      console.error("Split execution error:", err);
      setErrorMsg(getErrorMessage(err) || "Splitting process failed. Check media engine logs.");
    } finally {
      setSplitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !splitting) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl bg-[#0e0e11] border border-[#27272a] rounded-2xl shadow-2xl shadow-black/90 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-[#27272a] flex items-center justify-between bg-[#121215]/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-white tracking-tight">
                  Video Splitter
                </h3>
                <span
                  className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                    videoDetails.type === "online"
                      ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  }`}
                >
                  {videoDetails.type === "online" ? "Online Stream Slice" : "Local Lossless Cut"}
                </span>
              </div>
              <p className="text-xs text-[#a1a1aa] font-medium mt-0.5">
                {videoDetails.type === "online"
                  ? "Extract designated sections directly without downloading full video"
                  : "Blazing fast frame-copy cut without re-encoding"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={splitting}
            className="w-8 h-8 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#27272a] flex items-center justify-center cursor-pointer transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-grow overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 text-xs">
          {/* Target Video Summary Card */}
          <div className="p-3.5 rounded-xl bg-[#121215] border border-[#27272a] flex flex-col sm:flex-row items-start sm:items-center gap-3.5">
            {/* Thumbnail Preview */}
            <div className="relative w-28 aspect-video bg-[#09090b] rounded-lg overflow-hidden border border-[#27272a] shrink-0">
              {videoDetails.thumbnail ? (
                <img
                  src={videoDetails.thumbnail}
                  alt={videoDetails.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#71717a]">
                  <FileVideo className="w-5 h-5" />
                </div>
              )}
              {totalDurationSec > 0 && (
                <div className="absolute bottom-1 right-1 px-1 rounded bg-black/80 backdrop-blur-xs text-[9px] font-bold text-white flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5 text-amber-400" />
                  <span>{formatDuration(totalDurationSec)}</span>
                </div>
              )}
            </div>

            {/* Video Details */}
            <div className="flex flex-col min-w-0 flex-grow gap-1">
              <h4 className="font-bold text-white text-xs sm:text-sm line-clamp-1">
                {videoDetails.title}
              </h4>
              <div className="flex items-center gap-2 text-[11px] text-[#71717a] flex-wrap">
                {videoDetails.type === "online" ? (
                  <span className="flex items-center gap-1 text-blue-400">
                    <Globe className="w-3 h-3" />
                    <span>{detectPlatform(videoDetails.url || "").toUpperCase()}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <HardDrive className="w-3 h-3" />
                    <span>Local Disk File</span>
                  </span>
                )}
                <span>•</span>
                <span>
                  Total Duration:{" "}
                  <strong className="text-[#f4f4f5]">
                    {totalDurationSec > 0 ? formatDuration(totalDurationSec) : "Auto/Variable"}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          {/* URL Input Fallback if opened without pre-selected video */}
          {!source && !fetchedInfo && (
            <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-[#141418] border border-[#27272a]">
              <label className="text-[11px] font-bold text-[#a1a1aa] flex items-center justify-between">
                <span>Video Stream URL</span>
                {fetchingInfo && (
                  <span className="text-blue-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Fetching info...
                  </span>
                )}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => {
                    setInputUrl(e.target.value);
                    if (isSupportedMediaUrl(e.target.value)) {
                      fetchUrlInfo(e.target.value);
                    }
                  }}
                  placeholder="Paste YouTube, TikTok, or video URL..."
                  className="flex-grow bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          )}

          {/* Mode Selector Tabs */}
          <div className="flex items-center gap-1 p-1 bg-[#141418] border border-[#27272a] rounded-xl">
            <button
              type="button"
              onClick={() => setSplitMode("preset")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-bold transition-all cursor-pointer ${
                splitMode === "preset"
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-sm"
                  : "text-[#a1a1aa] hover:text-white"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Equal Duration Chunks</span>
            </button>
            <button
              type="button"
              onClick={() => setSplitMode("custom")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-bold transition-all cursor-pointer ${
                splitMode === "custom"
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-sm"
                  : "text-[#a1a1aa] hover:text-white"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Custom Range Cuts ({customSegments.length})</span>
            </button>
          </div>

          {/* TAB CONTENT: PRESET CHUNKS */}
          {splitMode === "preset" && (
            <div className="flex flex-col gap-3">
              {/* Preset Chips */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRESET_DURATIONS.map((p) => (
                  <button
                    key={p.sec}
                    type="button"
                    onClick={() => setSelectedPresetSec(p.sec)}
                    className={`p-2.5 rounded-xl border text-center font-bold flex flex-col items-center gap-0.5 cursor-pointer transition-all ${
                      selectedPresetSec === p.sec
                        ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                        : "bg-[#141418] border-[#27272a] text-[#a1a1aa] hover:text-white hover:border-[#3f3f46]"
                    }`}
                  >
                    <span className="text-xs">{p.label}</span>
                    <span className="text-[10px] text-[#71717a] font-mono">
                      Every {p.sec}s
                    </span>
                  </button>
                ))}
              </div>

              {/* Custom Interval Option */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#141418] border border-[#27272a]">
                <button
                  type="button"
                  onClick={() => setSelectedPresetSec(-1)}
                  className={`px-3 py-1.5 rounded-lg border font-bold text-xs cursor-pointer transition-all ${
                    selectedPresetSec === -1
                      ? "bg-amber-500/20 border-amber-500 text-amber-300"
                      : "bg-[#18181c] border-[#27272a] text-[#a1a1aa] hover:text-white"
                  }`}
                >
                  Custom Interval
                </button>
                {selectedPresetSec === -1 && (
                  <div className="flex items-center gap-2 flex-grow">
                    <input
                      type="number"
                      min={5}
                      max={3600}
                      value={customChunkInput}
                      onChange={(e) => setCustomChunkInput(e.target.value)}
                      placeholder="Interval in seconds..."
                      className="w-24 bg-[#09090b] border border-[#27272a] rounded-lg px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[11px] text-[#71717a]">seconds per clip</span>
                  </div>
                )}
              </div>

              {/* Preview Generated Chunks */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11px] text-[#a1a1aa] font-bold">
                  <span>Generated Breakdown ({activePresetSegments.length} Parts)</span>
                  <span className="text-[#71717a]">Auto-calculated</span>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-xl border border-[#27272a] bg-[#09090b] divide-y divide-[#1f1f23]">
                  {activePresetSegments.map((seg) => {
                    const sSec = timestampToSeconds(seg.start);
                    const eSec = timestampToSeconds(seg.end);
                    const diff = Math.max(0, eSec - sSec);
                    return (
                      <div
                        key={seg.partIndex}
                        className="px-3 py-2 flex items-center justify-between text-xs hover:bg-[#141418] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-md bg-[#1f1f23] text-[#a1a1aa] font-mono text-[10px] flex items-center justify-center font-bold">
                            {String(seg.partIndex).padStart(2, "0")}
                          </span>
                          <span className="font-semibold text-white">
                            {seg.label || `Part ${seg.partIndex}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[#a1a1aa] text-[11px]">
                            {seg.start} → {seg.end}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-mono text-[10px] font-bold">
                            {diff}s
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENT: CUSTOM SEGMENTS */}
          {splitMode === "custom" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[11px] text-[#a1a1aa] font-bold">
                <span>Segments List ({customSegments.length})</span>
                <button
                  type="button"
                  onClick={handleAddCustomSegment}
                  className="flex items-center gap-1 text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-lg border border-amber-500/20 cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Segment</span>
                </button>
              </div>

              <div className="max-h-52 overflow-y-auto flex flex-col gap-2 pr-1">
                {customSegments.map((seg, idx) => {
                  const sSec = timestampToSeconds(seg.start);
                  const eSec = timestampToSeconds(seg.end);
                  const dur = Math.max(0, eSec - sSec);

                  return (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-[#141418] border border-[#27272a] flex flex-col sm:flex-row sm:items-center gap-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md bg-[#27272a] text-white font-mono text-[10px] flex items-center justify-center font-bold shrink-0">
                          {idx + 1}
                        </span>
                        <input
                          type="text"
                          value={seg.label || `Part ${idx + 1}`}
                          onChange={(e) =>
                            handleUpdateCustomSegment(idx, "label", e.target.value)
                          }
                          placeholder="Label..."
                          className="w-24 bg-[#09090b] border border-[#27272a] rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div className="flex items-center gap-2 flex-grow">
                        <div className="flex flex-col flex-1">
                          <span className="text-[9px] text-[#71717a] font-bold">START</span>
                          <input
                            type="text"
                            value={seg.start}
                            onChange={(e) =>
                              handleUpdateCustomSegment(idx, "start", e.target.value)
                            }
                            placeholder="00:00:00"
                            className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <span className="text-[#71717a] mt-3">→</span>
                        <div className="flex flex-col flex-1">
                          <span className="text-[9px] text-[#71717a] font-bold">END</span>
                          <input
                            type="text"
                            value={seg.end}
                            onChange={(e) =>
                              handleUpdateCustomSegment(idx, "end", e.target.value)
                            }
                            placeholder="00:01:00"
                            className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <div className="flex flex-col items-center shrink-0 mt-3">
                          <span className="px-1.5 py-0.5 rounded bg-[#1f1f23] text-amber-400 font-mono text-[10px] font-bold">
                            {dur}s
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomSegment(idx)}
                          disabled={customSegments.length <= 1}
                          className="w-7 h-7 mt-3 rounded-md text-[#71717a] hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center cursor-pointer transition-colors disabled:opacity-20 shrink-0"
                          title="Remove Segment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Engine & Output Settings */}
          <div className="p-3.5 rounded-xl bg-[#141418] border border-[#27272a] flex flex-col gap-2.5">
            <span className="text-[11px] font-bold text-[#a1a1aa] uppercase tracking-wider">
              Output Options
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Dedicated Subfolder Toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-white">
                <input
                  type="checkbox"
                  checked={createSubfolder}
                  onChange={(e) => setCreateSubfolder(e.target.checked)}
                  className="rounded border-[#27272a] bg-[#09090b] text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span>Create folder <code className="text-[#a1a1aa] text-[10px] bg-[#09090b] px-1 py-0.5 rounded">[Title]_parts/</code></span>
              </label>

              {/* Fast Lossless Cut vs Precise Re-encode (for local files) */}
              {videoDetails.type === "local" && (
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-white">
                  <input
                    type="checkbox"
                    checked={preciseCut}
                    onChange={(e) => setPreciseCut(e.target.checked)}
                    className="rounded border-[#27272a] bg-[#09090b] text-amber-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Precise Cut (Re-encode frame-accurate)</span>
                </label>
              )}

              {/* Online stream quality & format */}
              {videoDetails.type === "online" && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[#71717a]">Format:</span>
                  <button
                    type="button"
                    onClick={() => setStreamFormat("video")}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                      streamFormat === "video"
                        ? "bg-blue-600 text-white"
                        : "bg-[#09090b] text-[#a1a1aa] border border-[#27272a]"
                    }`}
                  >
                    Video (MP4)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStreamFormat("audio")}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                      streamFormat === "audio"
                        ? "bg-blue-600 text-white"
                        : "bg-[#09090b] text-[#a1a1aa] border border-[#27272a]"
                    }`}
                  >
                    Audio (MP3)
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Progress / Status Display */}
          {splitting && progressEvent && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col gap-2 animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-amber-400 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    Splitting Part {progressEvent.partIndex} of {progressEvent.totalParts}...
                  </span>
                </span>
                <span className="font-mono text-amber-300 font-bold">
                  {Math.round(progressEvent.percent)}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${Math.max(progressEvent.percent, 5)}%` }}
                />
              </div>
              {progressEvent.title && (
                <span className="text-[11px] text-[#a1a1aa] truncate">
                  {progressEvent.title}
                </span>
              )}
            </div>
          )}

          {/* Completed Success State */}
          {completedParts.length > 0 && !splitting && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col gap-2.5 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Successfully created {completedParts.length} video parts!</span>
                </div>
                {outputFolder && (
                  <button
                    type="button"
                    onClick={() => openInExplorer(outputFolder)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Open Folder</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[#a1a1aa]">
                All segments have been indexed into Media Vault and saved to your storage.
              </p>
            </div>
          )}

          {/* Error Notice */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-[#27272a] flex items-center justify-between bg-[#121215]/80 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={splitting}
            className="px-4 py-2 rounded-xl text-xs font-bold text-[#a1a1aa] hover:text-white hover:bg-[#1f1f23] cursor-pointer transition-colors disabled:opacity-40"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleStartSplit}
            disabled={splitting || segmentsToProcess.length === 0}
            className="px-6 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer transition-all active:scale-98 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {splitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-black" />
                <span>Processing Split...</span>
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                <span>
                  Split Video ({segmentsToProcess.length} Parts)
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
