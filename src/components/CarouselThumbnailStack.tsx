import React, { useState } from "react";
import { Images, AlertTriangle } from "lucide-react";
import { DownloadRecord } from "../types";
import { convertLocalFileSrc } from "../lib/tauri-api";
import { getRecordThumbnail } from "../lib/utils";

interface CarouselThumbnailStackProps {
  record: DownloadRecord;
  slideCount: number;
  corruptOrMissing?: boolean;
}

export function getCarouselSlideCount(record: DownloadRecord): number | null {
  if (record.formatType !== "image") return null;

  // 1. Check title for explicit count: e.g. "[Carousel: 5 Images]"
  const match = record.title.match(/\[Carousel:?\s*(\d+)\s*Images?\]/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num > 1) return num;
  }

  // 2. Check if filename ends with sequence marker _01.jpg, _01.png, _1.jpg, etc.
  if (record.filePath && /_(01|1)\.(jpg|jpeg|png|webp)$/i.test(record.filePath)) {
    return 5;
  }

  // 3. Check if platform is Instagram or Pinterest and filename contains sequence numbers
  if (
    record.filePath &&
    (record.platform === "instagram" ||
      record.platform === "pinterest" ||
      record.url?.includes("instagram.com") ||
      record.url?.includes("pinterest.com") ||
      record.url?.includes("img_index=")) &&
    (/_\d{2}\./i.test(record.filePath) || record.url?.includes("img_index="))
  ) {
    return 5;
  }

  return null;
}

export const CarouselThumbnailStack: React.FC<CarouselThumbnailStackProps> = ({
  record,
  slideCount,
  corruptOrMissing = false,
}) => {
  const primaryThumb = getRecordThumbnail(record);

  // Resolve local paths for slide 1, 2, 3 in Tauri environment if available
  const resolveSlideUrls = (): string[] => {
    const list: string[] = [];
    if (record.filePath) {
      if (/_01\./i.test(record.filePath)) {
        list.push(convertLocalFileSrc(record.filePath));
        list.push(convertLocalFileSrc(record.filePath.replace(/_01\./i, "_02.")));
        list.push(convertLocalFileSrc(record.filePath.replace(/_01\./i, "_03.")));
      } else if (/_1\./i.test(record.filePath)) {
        list.push(convertLocalFileSrc(record.filePath));
        list.push(convertLocalFileSrc(record.filePath.replace(/_1\./i, "_2.")));
        list.push(convertLocalFileSrc(record.filePath.replace(/_1\./i, "_3.")));
      } else {
        list.push(convertLocalFileSrc(record.filePath));
      }
    }
    if (list.length === 0 && primaryThumb) {
      list.push(primaryThumb);
    }
    return list;
  };

  const slideUrls = resolveSlideUrls();
  const [img1, setImg1] = useState<string>(slideUrls[0] || primaryThumb);
  const [img2, setImg2] = useState<string>(slideUrls[1] || slideUrls[0] || primaryThumb);
  const [img3, setImg3] = useState<string>(slideUrls[2] || slideUrls[0] || primaryThumb);

  return (
    <div className="relative w-full h-full flex items-center justify-center p-0.5 select-none overflow-visible">
      {/* Layer 3: Back-most card (stepped top-right with tilt) */}
      <div className="absolute w-[80%] h-[80%] translate-x-2.5 -translate-y-1.5 rotate-6 rounded-md bg-[#18181c] border border-white/20 shadow-md overflow-hidden opacity-75 transition-transform group-hover:rotate-8 group-hover:translate-x-3">
        {img3 ? (
          <img
            src={img3}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => {
              if (primaryThumb && img3 !== primaryThumb) setImg3(primaryThumb);
            }}
            className={`w-full h-full object-cover ${
              corruptOrMissing ? "grayscale saturate-0" : ""
            }`}
          />
        ) : (
          <div className="w-full h-full bg-[#18181c]" />
        )}
      </div>

      {/* Layer 2: Middle card (stepped slightly top-right) */}
      <div className="absolute w-[83%] h-[83%] translate-x-1.5 -translate-y-0.5 rotate-3 rounded-md bg-[#141418] border border-white/25 shadow-lg overflow-hidden opacity-90 transition-transform group-hover:rotate-4 group-hover:translate-x-2">
        {img2 ? (
          <img
            src={img2}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => {
              if (primaryThumb && img2 !== primaryThumb) setImg2(primaryThumb);
            }}
            className={`w-full h-full object-cover ${
              corruptOrMissing ? "grayscale saturate-0" : ""
            }`}
          />
        ) : (
          <div className="w-full h-full bg-[#141418]" />
        )}
      </div>

      {/* Layer 1: Front card (main thumbnail) */}
      <div className="relative w-[86%] h-[86%] -translate-x-0.5 translate-y-0.5 rotate-0 rounded-md bg-[#09090b] border border-blue-500/40 shadow-xl overflow-hidden transition-transform group-hover:-translate-x-1 group-hover:translate-y-1">
        {img1 ? (
          <img
            src={img1}
            alt={record.title}
            referrerPolicy="no-referrer"
            onError={() => {
              if (primaryThumb && img1 !== primaryThumb) setImg1(primaryThumb);
            }}
            className={`w-full h-full object-cover ${
              corruptOrMissing ? "grayscale saturate-0" : ""
            }`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#09090b] text-zinc-500">
            <Images className="w-5 h-5" />
          </div>
        )}
      </div>

      {/* Center Slide Count Badge */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="px-2 py-0.5 rounded-full bg-black/85 backdrop-blur-md border border-white/25 text-white flex items-center gap-1 shadow-2xl transform scale-90 sm:scale-100 transition-transform">
          <Images className="w-3 h-3 text-blue-400 shrink-0" />
          <span className="text-[10px] font-extrabold tracking-wide whitespace-nowrap">
            {slideCount} Slides
          </span>
        </div>
      </div>

      {/* Broken / Corrupt Overlay if needed */}
      {corruptOrMissing && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[0.5px] flex items-center justify-center z-20">
          <AlertTriangle className="w-4 h-4 text-red-400 drop-shadow" />
        </div>
      )}
    </div>
  );
};



