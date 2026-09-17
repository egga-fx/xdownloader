import React, { useState, useEffect } from "react";
import { X, Check, Layers, Download, CheckSquare, Square } from "lucide-react";

interface CarouselSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: string[];
  postTitle?: string;
  initialSelectedIndices?: number[];
  onConfirm: (selectedIndices: number[]) => void;
}

export const CarouselSelectionModal: React.FC<CarouselSelectionModalProps> = ({
  isOpen,
  onClose,
  images,
  postTitle,
  initialSelectedIndices,
  onConfirm,
}) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Initialize selected set when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialSelectedIndices && initialSelectedIndices.length > 0) {
        setSelected(new Set(initialSelectedIndices));
      } else {
        // Default: select all
        setSelected(new Set(images.map((_, i) => i)));
      }
    }
  }, [isOpen, images, initialSelectedIndices]);

  // Handle ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleSelect = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selected.size === images.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(images.map((_, i) => i)));
    }
  };

  const handleDownload = () => {
    if (selected.size === 0) return;
    const sorted = Array.from(selected).sort((a, b) => a - b);
    onConfirm(sorted);
    onClose();
  };

  const isAllSelected = selected.size === images.length;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#121215] border border-[#27272a] rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-200">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-100 text-sm">Pilih Foto Carousel</h3>
              <p className="text-xs text-zinc-400 line-clamp-1">
                {postTitle || `Tersedia ${images.length} foto dalam album ini`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-[#1e1e24] transition-colors"
            title="Tutup (ESC)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="px-4 py-2.5 bg-[#18181b]/60 border-b border-[#27272a] flex items-center justify-between text-xs">
          <button
            onClick={handleSelectAll}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#27272a] hover:bg-zinc-700 text-zinc-200 transition-colors font-medium"
          >
            {isAllSelected ? (
              <>
                <Square className="w-3.5 h-3.5 text-zinc-400" />
                <span>Batalkan Semua</span>
              </>
            ) : (
              <>
                <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                <span>Pilih Semua</span>
              </>
            )}
          </button>

          <span className="text-zinc-400 font-medium">
            <strong className="text-zinc-100">{selected.size}</strong> dari {images.length} foto dipilih
          </span>
        </div>

        {/* Thumbnail Grid */}
        <div className="p-4 overflow-y-auto max-h-[55vh] grid grid-cols-2 sm:grid-cols-3 gap-3">
          {images.map((imgUrl, idx) => {
            const isChecked = selected.has(idx);
            return (
              <div
                key={idx}
                onClick={() => toggleSelect(idx)}
                className={`group relative aspect-square rounded-lg overflow-hidden border cursor-pointer select-none transition-all duration-150 ${
                  isChecked
                    ? "border-blue-500 ring-2 ring-blue-500/30 bg-blue-950/20"
                    : "border-[#27272a] hover:border-zinc-500 opacity-60 hover:opacity-90 bg-black/40"
                }`}
              >
                <img
                  src={imgUrl}
                  alt={`Slide ${idx + 1}`}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  loading="lazy"
                />

                {/* Index badge */}
                <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/75 backdrop-blur-xs text-[10px] font-semibold text-zinc-200 rounded">
                  #{idx + 1}
                </span>

                {/* Selection indicator */}
                <div className="absolute top-2 right-2">
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                      isChecked
                        ? "bg-blue-500 text-white shadow-sm"
                        : "bg-black/60 border border-zinc-500 text-transparent"
                    }`}
                  >
                    <Check className={`w-3.5 h-3.5 stroke-[2.5] ${isChecked ? "opacity-100" : "opacity-0"}`} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer CTA */}
        <div className="p-4 border-t border-[#27272a] bg-[#121215] flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181b] transition-colors"
          >
            Batal
          </button>

          <button
            onClick={handleDownload}
            disabled={selected.size === 0}
            className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-all ${
              selected.size > 0
                ? "bg-zinc-100 hover:bg-white text-zinc-950 shadow-sm cursor-pointer"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60"
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {selected.size === 0
                ? "Pilih Setidaknya 1 Foto"
                : selected.size === images.length
                ? `Download Semua (${images.length} Foto)`
                : `Download ${selected.size} Foto Pilihan`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
