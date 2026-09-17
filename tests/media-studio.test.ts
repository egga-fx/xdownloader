import { describe, expect, it } from "bun:test";
import {
  validateTrimRange,
  validateSplitSegments,
  generatePresetSegments,
  secondsToTimestamp,
  timestampToSeconds,
} from "../src/lib/utils";
import {
  TrimVideoRequest,
  TrimStreamRequest,
  SplitLocalRequest,
  SplitStreamRequest,
  SplitSegment,
} from "../src/types";

describe("AI Spec-First Contract Tests: Media Studio (Trimmer & Splitter)", () => {
  // --- 1. Video Trimmer Bounds Validation ---
  describe("validateTrimRange() [Timecode Boundaries & Invariants]", () => {
    it("should accept valid standard time ranges", () => {
      expect(validateTrimRange(0, 30, 120).valid).toBe(true);
      expect(validateTrimRange(15.5, 45.2, 60).valid).toBe(true);
      expect(validateTrimRange(0, 60, 60).valid).toBe(true);
    });

    it("should reject negative start timecodes", () => {
      const res = validateTrimRange(-5, 30, 100);
      expect(res.valid).toBe(false);
      expect(res.error).toBe("Start time cannot be negative");
    });

    it("should reject equal start and end timecodes (zero duration)", () => {
      const res = validateTrimRange(10, 10, 100);
      expect(res.valid).toBe(false);
      expect(res.error).toBe("End time must be greater than start time");
    });

    it("should reject inverted timecodes (start > end)", () => {
      const res = validateTrimRange(50, 20, 100);
      expect(res.valid).toBe(false);
      expect(res.error).toBe("End time must be greater than start time");
    });

    it("should reject trim duration below 0.1s threshold", () => {
      const res = validateTrimRange(10, 10.05, 100);
      expect(res.valid).toBe(false);
      expect(res.error).toBe("Trim duration must be at least 0.1 seconds");
    });

    it("should reject start time that exceeds or equals total duration", () => {
      const res = validateTrimRange(120, 130, 120);
      expect(res.valid).toBe(false);
      expect(res.error).toBe("Start time cannot exceed or equal total video duration");
    });

    it("should reject end time that exceeds total video duration with margin", () => {
      const res = validateTrimRange(10, 150, 120);
      expect(res.valid).toBe(false);
      expect(res.error).toBe("End time cannot exceed total video duration");
    });

    it("should reject NaN values for start or end time", () => {
      expect(validateTrimRange(NaN, 30).valid).toBe(false);
      expect(validateTrimRange(0, NaN).valid).toBe(false);
    });
  });

  // --- 2. Video Splitter Segment Validation ---
  describe("validateSplitSegments() [Sequence & Range Integrity]", () => {
    it("should accept valid chronological split segments", () => {
      const segments: SplitSegment[] = [
        { partIndex: 1, start: "00:00:00", end: "00:01:00", label: "Part 1" },
        { partIndex: 2, start: "00:01:00", end: "00:02:00", label: "Part 2" },
      ];
      const res = validateSplitSegments(segments, 120);
      expect(res.valid).toBe(true);
    });

    it("should reject empty segments array", () => {
      const res = validateSplitSegments([]);
      expect(res.valid).toBe(false);
      expect(res.error).toBe("At least one segment is required");
    });

    it("should reject segment with start >= end", () => {
      const segments: SplitSegment[] = [
        { partIndex: 1, start: "00:02:00", end: "00:01:00", label: "Part 1" },
      ];
      const res = validateSplitSegments(segments, 180);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("must be before end");
    });

    it("should reject segment that exceeds total duration by more than 1 second tolerance", () => {
      const segments: SplitSegment[] = [
        { partIndex: 1, start: "00:00:00", end: "00:05:00", label: "Part 1" },
      ];
      const res = validateSplitSegments(segments, 120); // 120s = 00:02:00, segment is 00:05:00
      expect(res.valid).toBe(false);
      expect(res.error).toContain("exceeds total duration");
    });
  });

  // --- 3. Split Partitioning Invariant Calculations ---
  describe("generatePresetSegments() Invariants", () => {
    it("should produce gapless coverage across the entire duration", () => {
      const totalSec = 215; // 3m 35s
      const chunkSec = 60;  // 1m
      const segments = generatePresetSegments(totalSec, chunkSec);

      expect(segments).toHaveLength(4);
      expect(segments[0].start).toBe("00:00:00");
      expect(segments[0].end).toBe("00:01:00");

      expect(segments[1].start).toBe("00:01:00");
      expect(segments[1].end).toBe("00:02:00");

      expect(segments[2].start).toBe("00:02:00");
      expect(segments[2].end).toBe("00:03:00");

      expect(segments[3].start).toBe("00:03:00");
      expect(segments[3].end).toBe(secondsToTimestamp(totalSec)); // 00:03:35

      // Invariant: start of next segment equals end of previous segment
      for (let i = 1; i < segments.length; i++) {
        expect(segments[i].start).toBe(segments[i - 1].end);
      }
    });

    it("should generate exactly 1 segment if total duration is smaller than chunk", () => {
      const segments = generatePresetSegments(25, 60);
      expect(segments).toHaveLength(1);
      expect(segments[0].start).toBe("00:00:00");
      expect(segments[0].end).toBe("00:00:25");
    });
  });

  // --- 4. IPC Request Contract Parity ---
  describe("Tauri IPC Media Request Payloads [Structural Typing Parity]", () => {
    it("should format valid TrimVideoRequest payload", () => {
      const req: TrimVideoRequest = {
        filePath: "C:\\Videos\\demo.mp4",
        startSec: 10,
        endSec: 40,
        outputFolder: "C:\\Videos\\Trimmed",
        preciseCut: true,
      };

      expect(req.filePath).toBe("C:\\Videos\\demo.mp4");
      expect(req.startSec).toBeLessThan(req.endSec);
      expect(typeof req.preciseCut).toBe("boolean");
    });

    it("should format valid TrimStreamRequest payload", () => {
      const req: TrimStreamRequest = {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        startSec: 0,
        endSec: 30,
        outputFolder: "C:\\Downloads",
        title: "Rick Astley Stream",
        quality: "1080p",
      };

      expect(req.url).toContain("youtube.com");
      expect(req.startSec).toBe(0);
      expect(req.endSec).toBe(30);
    });

    it("should format valid SplitLocalRequest payload with segments", () => {
      const segments: SplitSegment[] = [
        { partIndex: 1, start: "00:00:00", end: "00:00:30" },
        { partIndex: 2, start: "00:00:30", end: "00:01:00" },
      ];
      const req: SplitLocalRequest = {
        filePath: "D:\\media\\presentation.mp4",
        segments,
        outputFolder: "D:\\media\\splits",
        preciseCut: false,
        createSubfolder: true,
      };

      expect(req.segments).toHaveLength(2);
      expect(req.segments[0].partIndex).toBe(1);
      expect(req.segments[1].partIndex).toBe(2);
      expect(req.createSubfolder).toBe(true);
    });

    it("should format valid SplitStreamRequest payload", () => {
      const segments: SplitSegment[] = [
        { partIndex: 1, start: "00:00:00", end: "00:00:59" },
      ];
      const req: SplitStreamRequest = {
        url: "https://www.tiktok.com/@user/video/123",
        segments,
        outputFolder: "C:\\Clips",
        streamQuality: "best",
        streamFormat: "video",
      };

      expect(req.url).toContain("tiktok.com");
      expect(req.segments).toHaveLength(1);
      expect(req.streamQuality).toBe("best");
      expect(req.streamFormat).toBe("video");
    });
  });
});
