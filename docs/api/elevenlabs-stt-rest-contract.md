---
title: "ElevenLabs Speech-to-Text — REST contract (verified supplement)"
source: "https://elevenlabs.io/docs/api-reference/speech-to-text/convert"
extracted: "2026-10-07"
method: "defuddle (prose) + field names read from the page's embedded OpenAPI schema"
---

# Why this file exists

`defuddle` dropped the tabbed SDK/CLI code blocks from the quickstart pages
(see `elevenlabs-quickstart.md`, `elevenlabs-speech-to-text.md`). xDownloader
uses **raw REST from Rust (`reqwest`)**, not an SDK, so this file records the
exact HTTP contract needed for implementation.

Field names below were read from the official page schema. Items marked
**(unverified)** were not present in the extracted schema and MUST be confirmed
against a real response before being relied on.

# Request

```
POST https://api.elevenlabs.io/v1/speech-to-text
Header:  xi-api-key: <ELEVENLABS_API_KEY>
Body:    multipart/form-data
```

| Field | Type | Notes |
| :--- | :--- | :--- |
| `model_id` | string, **required** | `scribe_v2` (batch). Realtime variants are not for this flow. |
| `file` | binary | Exactly one of `file` / `source_url`. Max 5.0 GB, min 100 ms audio. |
| `source_url` | string | Server fetches a hosted file / YouTube / TikTok URL. Not used in v1 (see plan). |
| `language_code` | string? | ISO-639-1/3. Omit = auto-detect. |
| `diarize` | bool (false) | Speaker labels in `words[].speaker_id`. |
| `num_speakers` | int? 1-32 | Only meaningful with `diarize`. |
| `tag_audio_events` | bool (true) | Emits `(laughter)` etc. as words. Disable for clean subtitles. |
| `no_verbatim` | bool (false) | Drops filler words. `scribe_v2` only. |
| `timestamps_granularity` | enum | Use `word` (needed to build SRT locally). |
| `additional_formats` | list | Server-side export. Options objects: `SrtExportOptions`, `TxtExportOptions`, `SegmentedJsonExportOptions`, `Pdf/Html/Docx`. |
| `keyterms` | string[] | +20% surcharge. Not in v1. |
| `enable_logging` | bool (true) | `false` = zero-retention, **enterprise only**. |
| `webhook` | bool (false) | Async mode. Not used. |

`SrtExportOptions` fields: `format` (= `"srt"`), `max_characters_per_line`,
`include_speakers`, `include_timestamps`, `segment_on_silence_longer_than_s`,
`max_segment_duration_s`, `max_segment_chars`.

# Response (single channel, `SpeechToTextChunkResponseModel`)

| Field | Notes |
| :--- | :--- |
| `language_code`, `language_probability` | Detected language. |
| `text` | Full transcript. |
| `words[]` | `text`, `start`, `end` (seconds, float), `type`, `speaker_id`, `logprob`, `characters`, `channel_index`. |
| `audio_duration_secs` | Billing / progress reference. |
| `transcription_id` | |
| `additional_formats[]` | `requested_format`, `file_extension`, `content_type`, `content`. |
| `entities`, `edited_transcript` | Only when the matching option is requested. |

`words[].type` values: **(unverified)** expected `word`, `spacing`, `audio_event`.
The SRT builder must skip/handle non-`word` types defensively.

Other possible response shapes (must be handled as errors/unsupported in v1):
`MultichannelSpeechToTextResponseModel` (`use_multi_channel=true`) and
`SpeechToTextWebhookResponseModel` (`webhook=true`). v1 sends neither flag.

# Security notes

- Never log the `xi-api-key` header or the request body.
- API key is account-bound and billed per audio duration; treat as a secret.
- Surcharges: `entity_detection`/`entity_redaction`/`transcript_edit` +30%,
  `keyterms` +20%, `detect_speaker_roles` +10%. v1 uses none of these.
