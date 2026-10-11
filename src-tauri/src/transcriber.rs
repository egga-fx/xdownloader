//! Transcription support: subtitle rendering (SRT / VTT / TXT), transcription
//! config + API key lifecycle, and key verification.
//!
//! Everything in the "pure" sections is side-effect free and unit-tested from the
//! format contracts (not from the implementation). The API key never leaves this
//! module in clear text: UI-facing data goes through [`StoredTranscriptionConfig::to_public`].

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::db::Database;
use crate::downloader::{get_default_download_dir, sanitize_filename, ProcessManager};
use crate::models::{DownloadRecord, TimeRange, TranscriptionConfig, TranscriptionProgress};

pub const SETTINGS_KEY: &str = "transcription_config";
pub const PROVIDER_ELEVENLABS: &str = "elevenlabs";

pub const KEY_MISSING: &str = "missing";
pub const KEY_SAVED: &str = "saved";
pub const KEY_INVALID: &str = "invalid";

const ELEVENLABS_MODELS_URL: &str = "https://api.elevenlabs.io/v1/models";

// ---------------------------------------------------------------------------
// Pure section 1: normalized transcript words and cue building
// ---------------------------------------------------------------------------

/// Provider-agnostic word with timing. `kind` is "word" | "spacing" | "audio_event"
/// (unknown kinds are treated as words, defensively).
#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub kind: String,
    pub speaker: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CueOptions {
    pub max_chars_per_line: usize,
    pub max_cue_secs: f64,
    pub max_gap_secs: f64,
    pub include_audio_events: bool,
    pub include_speakers: bool,
}

impl Default for CueOptions {
    fn default() -> Self {
        Self {
            max_chars_per_line: 42,
            max_cue_secs: 6.0,
            max_gap_secs: 0.8,
            include_audio_events: false,
            include_speakers: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
    /// True on the first cue of a speaker run (renderers print the label only then).
    pub show_speaker: bool,
}

const MIN_CUE_SECS: f64 = 0.5;
const TXT_PARAGRAPH_GAP_SECS: f64 = 2.0;

struct CueAcc {
    words: Vec<String>,
    chars: usize,
    start: f64,
    end: f64,
    speaker: Option<String>,
}

fn is_usable(w: &TranscriptWord, opts: &CueOptions) -> bool {
    if !w.start.is_finite() || !w.end.is_finite() {
        return false;
    }
    if w.text.trim().is_empty() {
        return false;
    }
    match w.kind.as_str() {
        "spacing" => false,
        "audio_event" => opts.include_audio_events,
        _ => true,
    }
}

/// Collapses whitespace (incl. newlines) and neutralizes the SRT/VTT arrow token.
fn clean_text(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace("-->", "->")
}

fn ends_sentence(text: &str) -> bool {
    matches!(
        text.chars().last(),
        Some('.') | Some('?') | Some('!') | Some('。') | Some('？') | Some('！') | Some('…')
    )
}

fn finish(acc: CueAcc) -> Cue {
    Cue {
        start: acc.start,
        end: acc.end,
        text: acc.words.join(" "),
        speaker: acc.speaker,
        show_speaker: false,
    }
}

pub fn build_cues(words: &[TranscriptWord], opts: &CueOptions) -> Vec<Cue> {
    let max_chars = opts.max_chars_per_line.max(1);

    let mut usable: Vec<&TranscriptWord> = words.iter().filter(|w| is_usable(w, opts)).collect();
    usable.sort_by(|a, b| a.start.total_cmp(&b.start));

    let mut cues: Vec<Cue> = Vec::new();
    let mut acc: Option<CueAcc> = None;

    for w in usable {
        let text = clean_text(&w.text);
        if text.is_empty() {
            continue;
        }
        let start = w.start.max(0.0);
        let end = w.end.max(start);
        let speaker = if opts.include_speakers { w.speaker.clone() } else { None };
        let text_len = text.chars().count();

        let must_cut = match &acc {
            Some(cur) => {
                start - cur.end > opts.max_gap_secs
                    || end - cur.start > opts.max_cue_secs
                    || cur.chars + 1 + text_len > max_chars
                    || cur.speaker != speaker
            }
            None => false,
        };
        if must_cut {
            if let Some(done) = acc.take() {
                cues.push(finish(done));
            }
        }

        let sentence_end = ends_sentence(&text);
        match acc.as_mut() {
            Some(cur) => {
                cur.chars += 1 + text_len;
                cur.words.push(text);
                cur.end = cur.end.max(end);
            }
            None => {
                acc = Some(CueAcc {
                    words: vec![text],
                    chars: text_len,
                    start,
                    end,
                    speaker,
                });
            }
        }
        if sentence_end {
            if let Some(done) = acc.take() {
                cues.push(finish(done));
            }
        }
    }
    if let Some(done) = acc.take() {
        cues.push(finish(done));
    }

    // Timing sanity: positive duration, then no overlap with the next cue.
    for cue in cues.iter_mut() {
        if cue.end <= cue.start {
            cue.end = cue.start + MIN_CUE_SECS;
        }
    }
    for i in 0..cues.len().saturating_sub(1) {
        let next_start = cues[i + 1].start;
        if cues[i].end > next_start && next_start > cues[i].start {
            cues[i].end = next_start;
        }
    }

    // Speaker label is shown only when the speaker changes.
    let mut prev: Option<String> = None;
    for cue in cues.iter_mut() {
        cue.show_speaker = cue.speaker.is_some() && cue.speaker != prev;
        prev = cue.speaker.clone();
    }

    cues
}

// ---------------------------------------------------------------------------
// Pure section 2: renderers
// ---------------------------------------------------------------------------

fn split_ms(secs: f64) -> (u64, u64, u64, u64) {
    let total_ms: u64 = if secs.is_finite() && secs > 0.0 {
        (secs * 1000.0).round() as u64
    } else {
        0
    };
    (
        total_ms / 3_600_000,
        (total_ms / 60_000) % 60,
        (total_ms / 1000) % 60,
        total_ms % 1000,
    )
}

/// `HH:MM:SS,mmm` (comma separator, as required by SRT).
pub fn format_srt_time(secs: f64) -> String {
    let (h, m, s, ms) = split_ms(secs);
    format!("{:02}:{:02}:{:02},{:03}", h, m, s, ms)
}

/// `HH:MM:SS.mmm` (dot separator, as required by WebVTT).
pub fn format_vtt_time(secs: f64) -> String {
    let (h, m, s, ms) = split_ms(secs);
    format!("{:02}:{:02}:{:02}.{:03}", h, m, s, ms)
}

/// "speaker_0" -> "Speaker 1"; other ids are shown cleaned-up as-is.
pub fn speaker_label(id: &str) -> String {
    if let Some(rest) = id.strip_prefix("speaker_") {
        if let Ok(n) = rest.parse::<u32>() {
            return format!("Speaker {}", n.saturating_add(1));
        }
    }
    let cleaned = clean_text(id);
    if cleaned.is_empty() {
        "Speaker".to_string()
    } else {
        cleaned
    }
}

fn cue_text_with_speaker(cue: &Cue) -> String {
    match (&cue.speaker, cue.show_speaker) {
        (Some(id), true) => format!("[{}] {}", speaker_label(id), cue.text),
        _ => cue.text.clone(),
    }
}

pub fn build_srt(cues: &[Cue]) -> String {
    let mut out = String::new();
    for (i, cue) in cues.iter().enumerate() {
        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            format_srt_time(cue.start),
            format_srt_time(cue.end),
            cue_text_with_speaker(cue)
        ));
    }
    out
}

fn vtt_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn build_vtt(cues: &[Cue]) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for cue in cues {
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_vtt_time(cue.start),
            format_vtt_time(cue.end),
            vtt_escape(&cue_text_with_speaker(cue))
        ));
    }
    out
}

pub fn build_txt(cues: &[Cue]) -> String {
    let mut paragraphs: Vec<String> = Vec::new();
    let mut prev_end: Option<f64> = None;

    for cue in cues {
        let gap_break = prev_end
            .map(|pe| cue.start - pe >= TXT_PARAGRAPH_GAP_SECS)
            .unwrap_or(true);
        let new_paragraph = paragraphs.is_empty() || gap_break || cue.show_speaker;

        if new_paragraph {
            let text = match (&cue.speaker, cue.show_speaker) {
                (Some(id), true) => format!("{}: {}", speaker_label(id), cue.text),
                _ => cue.text.clone(),
            };
            paragraphs.push(text);
        } else if let Some(last) = paragraphs.last_mut() {
            last.push(' ');
            last.push_str(&cue.text);
        }
        prev_end = Some(cue.end);
    }

    if paragraphs.is_empty() {
        String::new()
    } else {
        format!("{}\n", paragraphs.join("\n\n"))
    }
}

// ---------------------------------------------------------------------------
// Config + API key lifecycle
// ---------------------------------------------------------------------------

/// Persisted config (includes the secret). Never serialize this to the UI.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StoredTranscriptionConfig {
    pub provider: String,
    pub api_key: Option<String>,
    pub key_status: String,
    pub model_id: String,
    pub language_code: Option<String>,
    pub diarize: bool,
    pub tag_audio_events: bool,
    pub max_chars_per_line: u32,
}

impl Default for StoredTranscriptionConfig {
    fn default() -> Self {
        Self {
            provider: PROVIDER_ELEVENLABS.to_string(),
            api_key: None,
            key_status: KEY_MISSING.to_string(),
            model_id: "scribe_v2".to_string(),
            language_code: None,
            diarize: false,
            tag_audio_events: false,
            max_chars_per_line: 42,
        }
    }
}

// Manual Debug so the secret can never leak through `{:?}` logging.
impl fmt::Debug for StoredTranscriptionConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StoredTranscriptionConfig")
            .field("provider", &self.provider)
            .field("api_key", &self.api_key.as_ref().map(|_| "<redacted>"))
            .field("key_status", &self.key_status)
            .field("model_id", &self.model_id)
            .field("language_code", &self.language_code)
            .field("diarize", &self.diarize)
            .field("tag_audio_events", &self.tag_audio_events)
            .field("max_chars_per_line", &self.max_chars_per_line)
            .finish()
    }
}

pub fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() < 12 {
        "••••".to_string()
    } else {
        let tail: String = chars[chars.len() - 4..].iter().collect();
        format!("••••{}", tail)
    }
}

fn validate_api_key(raw: &str) -> Result<String, String> {
    let key = raw.trim();
    if key.len() < 8 || key.len() > 256 {
        return Err("API key has an invalid length".to_string());
    }
    // Printable ASCII only: it is sent in an HTTP header, so no whitespace/control chars.
    if !key.chars().all(|c| c.is_ascii_graphic()) {
        return Err("API key contains invalid characters".to_string());
    }
    Ok(key.to_string())
}

fn validate_model_id(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if ok {
        Ok(id.to_string())
    } else {
        Err("Invalid model id".to_string())
    }
}

fn validate_language(raw: &Option<String>) -> Result<Option<String>, String> {
    match raw {
        None => Ok(None),
        Some(s) => {
            let code = s.trim().to_lowercase();
            if code.is_empty() {
                return Ok(None);
            }
            if (2..=3).contains(&code.len()) && code.chars().all(|c| c.is_ascii_lowercase()) {
                Ok(Some(code))
            } else {
                Err("Invalid language code (expected ISO-639-1/3, e.g. \"en\", \"id\")".to_string())
            }
        }
    }
}

impl StoredTranscriptionConfig {
    /// Re-establishes the invariant: no key => `missing`; key present => `saved` or `invalid`.
    pub fn normalize(&mut self) {
        if self.api_key.as_deref().map(|k| k.trim().is_empty()).unwrap_or(true) {
            self.api_key = None;
            self.key_status = KEY_MISSING.to_string();
        } else if self.key_status != KEY_INVALID {
            self.key_status = KEY_SAVED.to_string();
        }
    }

    pub fn to_public(&self) -> TranscriptionConfig {
        TranscriptionConfig {
            provider: self.provider.clone(),
            key_status: self.key_status.clone(),
            api_key_hint: self.api_key.as_deref().map(mask_key),
            model_id: self.model_id.clone(),
            language_code: self.language_code.clone(),
            diarize: self.diarize,
            tag_audio_events: self.tag_audio_events,
            max_chars_per_line: self.max_chars_per_line,
        }
    }

    /// Applies UI input. `api_key`: `None` keeps the current key, `Some("")` clears it,
    /// `Some(k)` stores a new key and resets the status to `saved`.
    /// Atomic: on validation error `self` is left untouched.
    pub fn apply_save(
        &mut self,
        incoming: &TranscriptionConfig,
        api_key: Option<&str>,
    ) -> Result<(), String> {
        if incoming.provider != PROVIDER_ELEVENLABS {
            return Err(format!("Unsupported provider: {}", incoming.provider));
        }
        let model_id = validate_model_id(&incoming.model_id)?;
        let language_code = validate_language(&incoming.language_code)?;

        let mut next = self.clone();
        next.model_id = model_id;
        next.language_code = language_code;
        next.diarize = incoming.diarize;
        next.tag_audio_events = incoming.tag_audio_events;
        next.max_chars_per_line = incoming.max_chars_per_line.clamp(20, 80);

        if let Some(raw) = api_key {
            if raw.trim().is_empty() {
                next.api_key = None;
            } else {
                next.api_key = Some(validate_api_key(raw)?);
                next.key_status = KEY_SAVED.to_string();
            }
        }

        next.normalize();
        *self = next;
        Ok(())
    }

    pub fn mark_invalid(&mut self) {
        if self.api_key.is_some() {
            self.key_status = KEY_INVALID.to_string();
        }
    }

    pub fn mark_valid(&mut self) {
        if self.api_key.is_some() {
            self.key_status = KEY_SAVED.to_string();
        }
    }

    /// Gate used by the backend before any work starts: returns the key only when usable.
    pub fn ensure_ready(&self) -> Result<&str, String> {
        match (self.api_key.as_deref(), self.key_status.as_str()) {
            (Some(k), KEY_SAVED) => Ok(k),
            (Some(_), _) => Err("API key was rejected by the provider. Please update it in Settings.".to_string()),
            (None, _) => Err("API key not configured".to_string()),
        }
    }
}

pub fn load_config(db: &Database) -> Result<StoredTranscriptionConfig, String> {
    let mut cfg = match db.get_setting(SETTINGS_KEY)? {
        Some(json) => serde_json::from_str::<StoredTranscriptionConfig>(&json).unwrap_or_default(),
        None => StoredTranscriptionConfig::default(),
    };
    cfg.normalize();
    Ok(cfg)
}

pub fn save_config(db: &Database, cfg: &StoredTranscriptionConfig) -> Result<(), String> {
    let json = serde_json::to_string(cfg)
        .map_err(|e| format!("Failed to serialize transcription config: {}", e))?;
    db.set_setting(SETTINGS_KEY, &json)
}

// ---------------------------------------------------------------------------
// Key verification (network)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyCheckOutcome {
    Valid,
    Rejected,
    /// Neither a clear accept nor a clear reject (e.g. 403: scope/IP restricted key).
    Inconclusive(u16),
}

/// Only 200 and 401 are conclusive for `GET /v1/models`. A key restricted to the
/// speech-to-text scope may legitimately get 403 there, so we must not flag it invalid.
pub fn classify_key_check(status: u16) -> KeyCheckOutcome {
    match status {
        200 => KeyCheckOutcome::Valid,
        401 => KeyCheckOutcome::Rejected,
        other => KeyCheckOutcome::Inconclusive(other),
    }
}

/// Verifies the stored key. `Ok(true)` valid, `Ok(false)` rejected (status -> invalid),
/// `Err` inconclusive/network (status unchanged).
pub async fn test_api_key(db: &Database) -> Result<bool, String> {
    let mut cfg = load_config(db)?;
    let key = cfg
        .api_key
        .clone()
        .ok_or_else(|| "API key not configured".to_string())?;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get(ELEVENLABS_MODELS_URL)
        .header("xi-api-key", key)
        .send()
        .await
        .map_err(|e| format!("Network error while verifying key: {}", e.without_url()))?;

    match classify_key_check(resp.status().as_u16()) {
        KeyCheckOutcome::Valid => {
            cfg.mark_valid();
            save_config(db, &cfg)?;
            Ok(true)
        }
        KeyCheckOutcome::Rejected => {
            cfg.mark_invalid();
            save_config(db, &cfg)?;
            Ok(false)
        }
        KeyCheckOutcome::Inconclusive(code) => Err(format!(
            "Could not verify the key (HTTP {}). It may be restricted to specific endpoints or IPs; try a transcription instead.",
            code
        )),
    }
}

// ---------------------------------------------------------------------------
// Pipeline execution and task management
// ---------------------------------------------------------------------------

pub struct TranscriptionManager {
    tasks: Mutex<HashMap<String, tokio::task::AbortHandle>>,
}

impl Default for TranscriptionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TranscriptionManager {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, task_id: String, handle: tokio::task::AbortHandle) {
        if let Ok(mut map) = self.tasks.lock() {
            map.insert(task_id, handle);
        }
    }

    pub fn remove(&self, task_id: &str) {
        if let Ok(mut map) = self.tasks.lock() {
            map.remove(task_id);
        }
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        if let Ok(mut map) = self.tasks.lock() {
            if let Some(handle) = map.remove(task_id) {
                handle.abort();
                return true;
            }
        }
        false
    }
}

#[derive(Debug, Deserialize)]
struct ElevenLabsWord {
    text: Option<String>,
    start: Option<f64>,
    end: Option<f64>,
    #[serde(rename = "type")]
    word_type: Option<String>,
    speaker_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ElevenLabsResponse {
    text: Option<String>,
    words: Option<Vec<ElevenLabsWord>>,
}

pub async fn run_transcription(
    app: AppHandle,
    db: Arc<Database>,
    process_mgr: Arc<ProcessManager>,
    _transcription_mgr: Arc<TranscriptionManager>,
    task_id: String,
    url: String,
    language_code: Option<String>,
    custom_name: Option<String>,
    output_folder: Option<String>,
    time_range: Option<TimeRange>,
) -> Result<String, String> {
    // Guard 1: Verify API key before touching network or disk
    let cfg = load_config(&db)?;
    let api_key = match cfg.ensure_ready() {
        Ok(k) => k.to_string(),
        Err(e) => {
            let err_prog = TranscriptionProgress {
                task_id: task_id.clone(),
                stage: "error".to_string(),
                percent: 0.0,
                message: e.clone(),
                error: Some(e.clone()),
                srt_path: None,
            };
            let _ = app.emit("transcription-progress", &err_prog);
            return Err(e);
        }
    };

    let _ = app.emit(
        "transcription-progress",
        &TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "downloading_audio".to_string(),
            percent: 10.0,
            message: "Extracting MP3 audio track...".to_string(),
            error: None,
            srt_path: None,
        },
    );

    let audio_task_id = format!("{}_audio", task_id);
    let dl_res = crate::downloader::run_download(
        app.clone(),
        db.clone(),
        process_mgr.clone(),
        audio_task_id.clone(),
        url.clone(),
        "audio".to_string(),
        "mp3".to_string(),
        None,
        None,
        None,
        None,
        custom_name.clone(),
        output_folder.clone(),
        false,
        time_range.clone(),
        None,
        None,
        None,
    )
    .await;

    if let Err(e) = dl_res {
        let _ = db.delete_record(&audio_task_id);
        let err_prog = TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "error".to_string(),
            percent: 0.0,
            message: e.clone(),
            error: Some(e.clone()),
            srt_path: None,
        };
        let _ = app.emit("transcription-progress", &err_prog);
        return Err(e);
    }

    if db.is_task_cancelled(&task_id) {
        let _ = db.delete_record(&audio_task_id);
        let cancel_prog = TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "cancelled".to_string(),
            percent: 0.0,
            message: "Transcription cancelled by user".to_string(),
            error: None,
            srt_path: None,
        };
        let _ = app.emit("transcription-progress", &cancel_prog);
        return Err("Transcription cancelled by user".to_string());
    }

    let (audio_status, audio_path_str) = match db.get_record_status_path(&audio_task_id)? {
        Some(pair) => pair,
        None => {
            let err = "Audio download record missing".to_string();
            let _ = app.emit(
                "transcription-progress",
                &TranscriptionProgress {
                    task_id: task_id.clone(),
                    stage: "error".to_string(),
                    percent: 0.0,
                    message: err.clone(),
                    error: Some(err.clone()),
                    srt_path: None,
                },
            );
            return Err(err);
        }
    };

    let audio_path = PathBuf::from(&audio_path_str);
    if !audio_path.exists() || audio_status != "completed" {
        let _ = db.delete_record(&audio_task_id);
        let err = "Extracted audio file not found on disk".to_string();
        let _ = app.emit(
            "transcription-progress",
            &TranscriptionProgress {
                task_id: task_id.clone(),
                stage: "error".to_string(),
                percent: 0.0,
                message: err.clone(),
                error: Some(err.clone()),
                srt_path: None,
            },
        );
        return Err(err);
    }

    let audio_records = db.get_records(None, None, None).unwrap_or_default();
    let audio_rec = audio_records.into_iter().find(|r| r.id == audio_task_id);
    let title = audio_rec.as_ref().map(|r| r.title.clone()).unwrap_or_else(|| "Media".to_string());
    let author = audio_rec.as_ref().map(|r| r.author.clone()).unwrap_or_default();
    let duration_sec = audio_rec.as_ref().map(|r| r.duration_sec).unwrap_or(0);
    let thumbnail_url = audio_rec.as_ref().map(|r| r.thumbnail_url.clone()).unwrap_or_default();
    let platform = audio_rec.as_ref().map(|r| r.platform.clone()).unwrap_or_else(|| "web_media".to_string());

    let _ = app.emit(
        "transcription-progress",
        &TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "uploading".to_string(),
            percent: 50.0,
            message: "Uploading audio to ElevenLabs Scribe...".to_string(),
            error: None,
            srt_path: None,
        },
    );

    let file_bytes = match tokio::fs::read(&audio_path).await {
        Ok(b) => b,
        Err(e) => {
            let _ = tokio::fs::remove_file(&audio_path).await;
            let _ = db.delete_record(&audio_task_id);
            let err = format!("Failed to read audio file: {}", e);
            let _ = app.emit(
                "transcription-progress",
                &TranscriptionProgress {
                    task_id: task_id.clone(),
                    stage: "error".to_string(),
                    percent: 0.0,
                    message: err.clone(),
                    error: Some(err.clone()),
                    srt_path: None,
                },
            );
            return Err(err);
        }
    };

    let boundary = format!("----xDownloaderBoundary{}", crate::uuid_short());
    let mut body = Vec::new();

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"model_id\"\r\n\r\n");
    body.extend_from_slice(cfg.model_id.as_bytes());
    body.extend_from_slice(b"\r\n");

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"tag_audio_events\"\r\n\r\n");
    body.extend_from_slice(if cfg.tag_audio_events { b"true\r\n" } else { b"false\r\n" });

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"diarize\"\r\n\r\n");
    body.extend_from_slice(if cfg.diarize { b"true\r\n" } else { b"false\r\n" });

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"timestamps_granularity\"\r\n\r\nword\r\n");

    let active_lang = language_code.as_ref().or(cfg.language_code.as_ref());
    if let Some(l) = active_lang {
        if !l.trim().is_empty() {
            body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
            body.extend_from_slice(b"Content-Disposition: form-data; name=\"language_code\"\r\n\r\n");
            body.extend_from_slice(l.trim().as_bytes());
            body.extend_from_slice(b"\r\n");
        }
    }

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"file\"; filename=\"audio.mp3\"\r\n");
    body.extend_from_slice(b"Content-Type: audio/mpeg\r\n\r\n");
    body.extend_from_slice(&file_bytes);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))?;

    let _ = app.emit(
        "transcription-progress",
        &TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "transcribing".to_string(),
            percent: 75.0,
            message: "Transcribing audio with Scribe v2...".to_string(),
            error: None,
            srt_path: None,
        },
    );

    let req = client
        .post("https://api.elevenlabs.io/v1/speech-to-text")
        .header("xi-api-key", &api_key)
        .header("Content-Type", format!("multipart/form-data; boundary={}", boundary))
        .body(body);

    let resp_result = req.send().await;

    // Guaranteed cleanup of MP3 file and audio DB record (Rule D8)
    let _ = tokio::fs::remove_file(&audio_path).await;
    let _ = db.delete_record(&audio_task_id);

    let resp = match resp_result {
        Ok(r) => r,
        Err(e) => {
            let err = format!("API request failed: {}", e.without_url());
            let _ = app.emit(
                "transcription-progress",
                &TranscriptionProgress {
                    task_id: task_id.clone(),
                    stage: "error".to_string(),
                    percent: 0.0,
                    message: err.clone(),
                    error: Some(err.clone()),
                    srt_path: None,
                },
            );
            return Err(err);
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            let mut cur_cfg = load_config(&db)?;
            cur_cfg.mark_invalid();
            let _ = save_config(&db, &cur_cfg);
        }
        let err_msg = format!("ElevenLabs API Error (HTTP {}): {}", status.as_u16(), err_body);
        let _ = app.emit(
            "transcription-progress",
            &TranscriptionProgress {
                task_id: task_id.clone(),
                stage: "error".to_string(),
                percent: 0.0,
                message: err_msg.clone(),
                error: Some(err_msg.clone()),
                srt_path: None,
            },
        );
        return Err(err_msg);
    }

    let json_bytes = resp.bytes().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let parsed: ElevenLabsResponse = serde_json::from_slice(&json_bytes)
        .map_err(|e| format!("Failed to parse ElevenLabs response: {}", e))?;

    let mut words: Vec<TranscriptWord> = Vec::new();
    if let Some(raw_words) = parsed.words {
        for w in raw_words {
            let text = w.text.unwrap_or_default();
            if text.trim().is_empty() {
                continue;
            }
            let start = w.start.unwrap_or(0.0);
            let end = w.end.unwrap_or(start + 0.4);
            words.push(TranscriptWord {
                text,
                start,
                end,
                kind: w.word_type.unwrap_or_else(|| "word".to_string()),
                speaker: w.speaker_id,
            });
        }
    }

    if words.is_empty() {
        if let Some(raw_text) = parsed.text {
            if !raw_text.trim().is_empty() {
                words.push(TranscriptWord {
                    text: raw_text.trim().to_string(),
                    start: 0.0,
                    end: duration_sec.max(5) as f64,
                    kind: "word".to_string(),
                    speaker: None,
                });
            }
        }
    }

    if words.is_empty() {
        let err_msg = "No spoken words detected in the media.".to_string();
        let _ = app.emit(
            "transcription-progress",
            &TranscriptionProgress {
                task_id: task_id.clone(),
                stage: "error".to_string(),
                percent: 0.0,
                message: err_msg.clone(),
                error: Some(err_msg.clone()),
                srt_path: None,
            },
        );
        return Err(err_msg);
    }

    let _ = app.emit(
        "transcription-progress",
        &TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "writing_files".to_string(),
            percent: 90.0,
            message: "Generating SRT, VTT, and TXT subtitle files...".to_string(),
            error: None,
            srt_path: None,
        },
    );

    let cue_opts = CueOptions {
        max_chars_per_line: cfg.max_chars_per_line as usize,
        include_audio_events: cfg.tag_audio_events,
        include_speakers: cfg.diarize,
        ..Default::default()
    };
    let cues = build_cues(&words, &cue_opts);
    let srt_content = build_srt(&cues);
    let vtt_content = build_vtt(&cues);
    let txt_content = build_txt(&cues);

    let out_dir = match output_folder {
        Some(ref f) if !f.trim().is_empty() => PathBuf::from(f),
        _ => get_default_download_dir(),
    };
    let _ = tokio::fs::create_dir_all(&out_dir).await;

    let stem = match custom_name {
        Some(ref n) if !n.trim().is_empty() => sanitize_filename(n),
        _ => sanitize_filename(&title),
    };

    let srt_path = out_dir.join(format!("{}.srt", stem));
    let vtt_path = out_dir.join(format!("{}.vtt", stem));
    let txt_path = out_dir.join(format!("{}.txt", stem));

    let srt_tmp = out_dir.join(format!("{}.srt.tmp", stem));
    let vtt_tmp = out_dir.join(format!("{}.vtt.tmp", stem));
    let txt_tmp = out_dir.join(format!("{}.txt.tmp", stem));

    tokio::fs::write(&srt_tmp, srt_content.as_bytes()).await.map_err(|e| e.to_string())?;
    tokio::fs::write(&vtt_tmp, vtt_content.as_bytes()).await.map_err(|e| e.to_string())?;
    tokio::fs::write(&txt_tmp, txt_content.as_bytes()).await.map_err(|e| e.to_string())?;

    let _ = tokio::fs::rename(&srt_tmp, &srt_path).await;
    let _ = tokio::fs::rename(&vtt_tmp, &vtt_path).await;
    let _ = tokio::fs::rename(&txt_tmp, &txt_path).await;

    let srt_size = tokio::fs::metadata(&srt_path)
        .await
        .map(|m| m.len() as i64)
        .unwrap_or(srt_content.len() as i64);

    let srt_record = DownloadRecord {
        id: format!("{}_srt", task_id),
        platform,
        url: url.clone(),
        title: format!("{} [Transcript]", title),
        author,
        duration_sec,
        thumbnail_url,
        format_type: "subtitle".to_string(),
        quality: "srt".to_string(),
        file_path: srt_path.to_string_lossy().to_string(),
        file_size_bytes: srt_size,
        status: "completed".to_string(),
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        time_range,
        exists: true,
    };
    let _ = db.add_record(&srt_record);

    let srt_path_str = srt_path.to_string_lossy().to_string();
    let final_progress = TranscriptionProgress {
        task_id: task_id.clone(),
        stage: "completed".to_string(),
        percent: 100.0,
        message: "Transcript created successfully!".to_string(),
        error: None,
        srt_path: Some(srt_path_str.clone()),
    };
    let _ = app.emit("transcription-progress", &final_progress);

    Ok(srt_path_str)
}

pub async fn run_file_transcription(
    app: AppHandle,
    db: Arc<Database>,
    process_mgr: Arc<ProcessManager>,
    task_id: String,
    file_path_str: String,
    language_code: Option<String>,
    custom_name: Option<String>,
    output_folder: Option<String>,
) -> Result<String, String> {
    // Guard 1: Verify API key
    let cfg = load_config(&db)?;
    let api_key = match cfg.ensure_ready() {
        Ok(k) => k.to_string(),
        Err(e) => {
            let err_prog = TranscriptionProgress {
                task_id: task_id.clone(),
                stage: "error".to_string(),
                percent: 0.0,
                message: e.clone(),
                error: Some(e.clone()),
                srt_path: None,
            };
            let _ = app.emit("transcription-progress", &err_prog);
            return Err(e);
        }
    };

    let input_path = PathBuf::from(&file_path_str);
    if !input_path.exists() {
        let err = format!("Input media file does not exist: {}", file_path_str);
        let _ = app.emit(
            "transcription-progress",
            &TranscriptionProgress {
                task_id: task_id.clone(),
                stage: "error".to_string(),
                percent: 0.0,
                message: err.clone(),
                error: Some(err.clone()),
                srt_path: None,
            },
        );
        return Err(err);
    }

    let _ = app.emit(
        "transcription-progress",
        &TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "downloading_audio".to_string(),
            percent: 15.0,
            message: "Preparing audio stream...".to_string(),
            error: None,
            srt_path: None,
        },
    );

    let ext = input_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let (audio_path, is_temp) = if ext == "mp3" {
        (input_path.clone(), false)
    } else {
        // Convert to temp MP3 using ffmpeg
        let ffmpeg_bin = crate::binaries::find_binary("ffmpeg").ok_or_else(|| {
            let err = "FFmpeg binary is not installed. Please set up engines first.".to_string();
            let _ = app.emit(
                "transcription-progress",
                &TranscriptionProgress {
                    task_id: task_id.clone(),
                    stage: "error".to_string(),
                    percent: 0.0,
                    message: err.clone(),
                    error: Some(err.clone()),
                    srt_path: None,
                },
            );
            err
        })?;

        let temp_mp3 = std::env::temp_dir().join(format!("{}.mp3", task_id));

        let mut cmd = std::process::Command::new(&ffmpeg_bin);
        cmd.args(["-y", "-i"])
            .arg(&input_path)
            .args(["-vn", "-acodec", "libmp3lame", "-ab", "128k", "-ar", "44100"])
            .arg(&temp_mp3);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;
        let pid = child.id();
        let stem = input_path.file_stem().and_then(|s| s.to_str()).unwrap_or("media").to_string();
        process_mgr.register(task_id.clone(), pid, std::env::temp_dir(), stem);

        let status_res = tokio::task::spawn_blocking(move || child.wait()).await;
        process_mgr.remove(&task_id);

        match status_res {
            Ok(Ok(status)) if status.success() => (temp_mp3, true),
            Ok(Ok(status)) => {
                let _ = tokio::fs::remove_file(&temp_mp3).await;
                let err = format!("FFmpeg failed with exit code: {:?}", status.code());
                let _ = app.emit(
                    "transcription-progress",
                    &TranscriptionProgress {
                        task_id: task_id.clone(),
                        stage: "error".to_string(),
                        percent: 0.0,
                        message: err.clone(),
                        error: Some(err.clone()),
                        srt_path: None,
                    },
                );
                return Err(err);
            }
            _ => {
                let _ = tokio::fs::remove_file(&temp_mp3).await;
                let err = "FFmpeg process failed or was interrupted".to_string();
                let _ = app.emit(
                    "transcription-progress",
                    &TranscriptionProgress {
                        task_id: task_id.clone(),
                        stage: "error".to_string(),
                        percent: 0.0,
                        message: err.clone(),
                        error: Some(err.clone()),
                        srt_path: None,
                    },
                );
                return Err(err);
            }
        }
    };

    let _ = app.emit(
        "transcription-progress",
        &TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "uploading".to_string(),
            percent: 50.0,
            message: "Uploading audio to ElevenLabs Scribe...".to_string(),
            error: None,
            srt_path: None,
        },
    );

    let file_bytes = match tokio::fs::read(&audio_path).await {
        Ok(b) => b,
        Err(e) => {
            if is_temp {
                let _ = tokio::fs::remove_file(&audio_path).await;
            }
            let err = format!("Failed to read audio file: {}", e);
            let _ = app.emit(
                "transcription-progress",
                &TranscriptionProgress {
                    task_id: task_id.clone(),
                    stage: "error".to_string(),
                    percent: 0.0,
                    message: err.clone(),
                    error: Some(err.clone()),
                    srt_path: None,
                },
            );
            return Err(err);
        }
    };

    if is_temp {
        let _ = tokio::fs::remove_file(&audio_path).await;
    }

    let boundary = format!("----xDownloaderBoundary{}", crate::uuid_short());
    let mut body = Vec::new();

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"model_id\"\r\n\r\n");
    body.extend_from_slice(cfg.model_id.as_bytes());
    body.extend_from_slice(b"\r\n");

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"tag_audio_events\"\r\n\r\n");
    body.extend_from_slice(if cfg.tag_audio_events { b"true\r\n" } else { b"false\r\n" });

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"diarize\"\r\n\r\n");
    body.extend_from_slice(if cfg.diarize { b"true\r\n" } else { b"false\r\n" });

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"timestamps_granularity\"\r\n\r\nword\r\n");

    let active_lang = language_code.as_ref().or(cfg.language_code.as_ref());
    if let Some(l) = active_lang {
        if !l.trim().is_empty() {
            body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
            body.extend_from_slice(b"Content-Disposition: form-data; name=\"language_code\"\r\n\r\n");
            body.extend_from_slice(l.trim().as_bytes());
            body.extend_from_slice(b"\r\n");
        }
    }

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"file\"; filename=\"audio.mp3\"\r\n");
    body.extend_from_slice(b"Content-Type: audio/mpeg\r\n\r\n");
    body.extend_from_slice(&file_bytes);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))?;

    let _ = app.emit(
        "transcription-progress",
        &TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "transcribing".to_string(),
            percent: 75.0,
            message: "Transcribing audio with Scribe v2...".to_string(),
            error: None,
            srt_path: None,
        },
    );

    let req = client
        .post("https://api.elevenlabs.io/v1/speech-to-text")
        .header("xi-api-key", &api_key)
        .header("Content-Type", format!("multipart/form-data; boundary={}", boundary))
        .body(body);

    let resp_result = req.send().await;

    let resp = match resp_result {
        Ok(r) => r,
        Err(e) => {
            let err = format!("API request failed: {}", e.without_url());
            let _ = app.emit(
                "transcription-progress",
                &TranscriptionProgress {
                    task_id: task_id.clone(),
                    stage: "error".to_string(),
                    percent: 0.0,
                    message: err.clone(),
                    error: Some(err.clone()),
                    srt_path: None,
                },
            );
            return Err(err);
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            let mut cur_cfg = load_config(&db)?;
            cur_cfg.mark_invalid();
            let _ = save_config(&db, &cur_cfg);
        }
        let err_msg = format!("ElevenLabs API Error (HTTP {}): {}", status.as_u16(), err_body);
        let _ = app.emit(
            "transcription-progress",
            &TranscriptionProgress {
                task_id: task_id.clone(),
                stage: "error".to_string(),
                percent: 0.0,
                message: err_msg.clone(),
                error: Some(err_msg.clone()),
                srt_path: None,
            },
        );
        return Err(err_msg);
    }

    let json_bytes = resp.bytes().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let parsed: ElevenLabsResponse = serde_json::from_slice(&json_bytes)
        .map_err(|e| format!("Failed to parse ElevenLabs response: {}", e))?;

    let mut words: Vec<TranscriptWord> = Vec::new();
    if let Some(raw_words) = parsed.words {
        for w in raw_words {
            let text = w.text.unwrap_or_default();
            if text.trim().is_empty() {
                continue;
            }
            let start = w.start.unwrap_or(0.0);
            let end = w.end.unwrap_or(start + 0.4);
            words.push(TranscriptWord {
                text,
                start,
                end,
                kind: w.word_type.unwrap_or_else(|| "word".to_string()),
                speaker: w.speaker_id,
            });
        }
    }

    if words.is_empty() {
        if let Some(raw_text) = parsed.text {
            if !raw_text.trim().is_empty() {
                words.push(TranscriptWord {
                    text: raw_text.trim().to_string(),
                    start: 0.0,
                    end: 10.0,
                    kind: "word".to_string(),
                    speaker: None,
                });
            }
        }
    }

    if words.is_empty() {
        let err_msg = "No spoken words detected in the media.".to_string();
        let _ = app.emit(
            "transcription-progress",
            &TranscriptionProgress {
                task_id: task_id.clone(),
                stage: "error".to_string(),
                percent: 0.0,
                message: err_msg.clone(),
                error: Some(err_msg.clone()),
                srt_path: None,
            },
        );
        return Err(err_msg);
    }

    let _ = app.emit(
        "transcription-progress",
        &TranscriptionProgress {
            task_id: task_id.clone(),
            stage: "writing_files".to_string(),
            percent: 90.0,
            message: "Generating SRT, VTT, and TXT subtitle files...".to_string(),
            error: None,
            srt_path: None,
        },
    );

    let cue_opts = CueOptions {
        max_chars_per_line: cfg.max_chars_per_line as usize,
        include_audio_events: cfg.tag_audio_events,
        include_speakers: cfg.diarize,
        ..Default::default()
    };
    let cues = build_cues(&words, &cue_opts);
    let srt_content = build_srt(&cues);
    let vtt_content = build_vtt(&cues);
    let txt_content = build_txt(&cues);

    let out_dir = match output_folder {
        Some(ref f) if !f.trim().is_empty() => PathBuf::from(f),
        _ => {
            if let Some(parent) = input_path.parent() {
                parent.to_path_buf()
            } else {
                get_default_download_dir()
            }
        }
    };
    let _ = tokio::fs::create_dir_all(&out_dir).await;

    let default_stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("media");

    let stem = match custom_name {
        Some(ref n) if !n.trim().is_empty() => sanitize_filename(n),
        _ => sanitize_filename(default_stem),
    };

    let srt_path = out_dir.join(format!("{}.srt", stem));
    let vtt_path = out_dir.join(format!("{}.vtt", stem));
    let txt_path = out_dir.join(format!("{}.txt", stem));

    let srt_tmp = out_dir.join(format!("{}.srt.tmp", stem));
    let vtt_tmp = out_dir.join(format!("{}.vtt.tmp", stem));
    let txt_tmp = out_dir.join(format!("{}.txt.tmp", stem));

    tokio::fs::write(&srt_tmp, srt_content.as_bytes()).await.map_err(|e| e.to_string())?;
    tokio::fs::write(&vtt_tmp, vtt_content.as_bytes()).await.map_err(|e| e.to_string())?;
    tokio::fs::write(&txt_tmp, txt_content.as_bytes()).await.map_err(|e| e.to_string())?;

    let _ = tokio::fs::rename(&srt_tmp, &srt_path).await;
    let _ = tokio::fs::rename(&vtt_tmp, &vtt_path).await;
    let _ = tokio::fs::rename(&txt_tmp, &txt_path).await;

    let srt_size = tokio::fs::metadata(&srt_path)
        .await
        .map(|m| m.len() as i64)
        .unwrap_or(srt_content.len() as i64);

    let srt_record = DownloadRecord {
        id: format!("{}_srt", task_id),
        platform: "local_file".to_string(),
        url: file_path_str.clone(),
        title: format!("{} [Transcript]", stem),
        author: "Local Studio".to_string(),
        duration_sec: 0,
        thumbnail_url: String::new(),
        format_type: "subtitle".to_string(),
        quality: "srt".to_string(),
        file_path: srt_path.to_string_lossy().to_string(),
        file_size_bytes: srt_size,
        status: "completed".to_string(),
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        time_range: None,
        exists: true,
    };
    let _ = db.add_record(&srt_record);

    let srt_path_str = srt_path.to_string_lossy().to_string();
    let final_progress = TranscriptionProgress {
        task_id: task_id.clone(),
        stage: "completed".to_string(),
        percent: 100.0,
        message: "Transcript created successfully!".to_string(),
        error: None,
        srt_path: Some(srt_path_str.clone()),
    };
    let _ = app.emit("transcription-progress", &final_progress);

    Ok(srt_path_str)
}

// ---------------------------------------------------------------------------
// Tests (written from the format/behavior contracts)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn w(text: &str, start: f64, end: f64) -> TranscriptWord {
        TranscriptWord {
            text: text.to_string(),
            start,
            end,
            kind: "word".to_string(),
            speaker: None,
        }
    }

    fn ws(text: &str, start: f64, end: f64, speaker: &str) -> TranscriptWord {
        TranscriptWord {
            speaker: Some(speaker.to_string()),
            ..w(text, start, end)
        }
    }

    fn kind(mut word: TranscriptWord, k: &str) -> TranscriptWord {
        word.kind = k.to_string();
        word
    }

    fn texts(cues: &[Cue]) -> Vec<&str> {
        cues.iter().map(|c| c.text.as_str()).collect()
    }

    // ---- time formatting ----

    #[test]
    fn srt_time_uses_comma_and_pads() {
        assert_eq!(format_srt_time(0.0), "00:00:00,000");
        assert_eq!(format_srt_time(1.5), "00:00:01,500");
        assert_eq!(format_srt_time(3599.5), "00:59:59,500");
        assert_eq!(format_srt_time(3661.001), "01:01:01,001");
    }

    #[test]
    fn srt_time_carries_on_rounding() {
        assert_eq!(format_srt_time(59.9996), "00:01:00,000");
    }

    #[test]
    fn time_is_clamped_for_invalid_input() {
        assert_eq!(format_srt_time(-5.0), "00:00:00,000");
        assert_eq!(format_srt_time(f64::NAN), "00:00:00,000");
        assert_eq!(format_srt_time(f64::INFINITY), "00:00:00,000");
    }

    #[test]
    fn vtt_time_uses_dot() {
        assert_eq!(format_vtt_time(1.5), "00:00:01.500");
        assert_eq!(format_vtt_time(3661.001), "01:01:01.001");
    }

    // ---- cue building ----

    #[test]
    fn empty_input_yields_no_cues() {
        assert!(build_cues(&[], &CueOptions::default()).is_empty());
    }

    #[test]
    fn single_sentence_becomes_one_cue_with_word_timings() {
        let words = vec![w("Hello", 0.0, 0.4), w("world.", 0.5, 1.2)];
        let cues = build_cues(&words, &CueOptions::default());
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text, "Hello world.");
        assert_eq!(cues[0].start, 0.0);
        assert_eq!(cues[0].end, 1.2);
    }

    #[test]
    fn spacing_is_skipped_and_audio_events_follow_the_option() {
        let words = vec![
            w("Hi", 0.0, 0.2),
            kind(w(" ", 0.2, 0.3), "spacing"),
            kind(w("(laughter)", 0.3, 0.6), "audio_event"),
            w("there.", 0.7, 1.0),
        ];
        let off = build_cues(&words, &CueOptions::default());
        assert_eq!(texts(&off), vec!["Hi there."]);

        let opts = CueOptions { include_audio_events: true, ..Default::default() };
        let on = build_cues(&words, &opts);
        assert_eq!(texts(&on), vec!["Hi (laughter) there."]);
    }

    #[test]
    fn unknown_kind_is_treated_as_a_word() {
        let words = vec![kind(w("mystery.", 0.0, 0.5), "something_new")];
        assert_eq!(texts(&build_cues(&words, &CueOptions::default())), vec!["mystery."]);
    }

    #[test]
    fn blank_and_non_finite_words_are_dropped() {
        let words = vec![
            w("   ", 0.0, 0.1),
            w("bad", f64::NAN, 0.5),
            w("ok.", 1.0, 1.5),
        ];
        assert_eq!(texts(&build_cues(&words, &CueOptions::default())), vec!["ok."]);
    }

    #[test]
    fn long_silence_splits_cue() {
        let words = vec![w("a", 0.0, 0.5), w("b", 1.4, 1.8)]; // gap 0.9 > 0.8
        assert_eq!(texts(&build_cues(&words, &CueOptions::default())), vec!["a", "b"]);
    }

    #[test]
    fn short_pause_does_not_split_cue() {
        let words = vec![w("a", 0.0, 0.5), w("b", 1.2, 1.6)]; // gap 0.7
        assert_eq!(texts(&build_cues(&words, &CueOptions::default())), vec!["a b"]);
    }

    #[test]
    fn character_limit_splits_cue() {
        let opts = CueOptions { max_chars_per_line: 11, ..Default::default() };
        let words = vec![w("hello", 0.0, 0.2), w("world", 0.2, 0.4), w("foo", 0.4, 0.6)];
        // "hello world" is exactly 11 chars (allowed); adding " foo" exceeds the limit.
        assert_eq!(texts(&build_cues(&words, &opts)), vec!["hello world", "foo"]);
    }

    #[test]
    fn single_word_longer_than_limit_is_kept_whole() {
        let opts = CueOptions { max_chars_per_line: 5, ..Default::default() };
        let words = vec![w("extraordinary", 0.0, 0.5), w("ok", 0.5, 0.8)];
        assert_eq!(texts(&build_cues(&words, &opts)), vec!["extraordinary", "ok"]);
    }

    #[test]
    fn sentence_end_splits_cue() {
        let words = vec![w("Hi.", 0.0, 0.3), w("Bye.", 0.4, 0.8)];
        assert_eq!(texts(&build_cues(&words, &CueOptions::default())), vec!["Hi.", "Bye."]);
    }

    #[test]
    fn duration_limit_splits_cue() {
        let words = vec![w("a", 0.0, 2.0), w("b", 2.0, 4.0), w("c", 4.0, 6.5)];
        assert_eq!(texts(&build_cues(&words, &CueOptions::default())), vec!["a b", "c"]);
    }

    #[test]
    fn unsorted_words_are_ordered_by_start() {
        let words = vec![w("world.", 0.5, 1.0), w("Hello", 0.0, 0.4)];
        assert_eq!(texts(&build_cues(&words, &CueOptions::default())), vec!["Hello world."]);
    }

    #[test]
    fn zero_duration_cue_gets_positive_length() {
        let cues = build_cues(&[w("a.", 2.0, 2.0)], &CueOptions::default());
        assert!(cues[0].end > cues[0].start);
        assert_eq!(cues[0].end, 2.5);
    }

    #[test]
    fn cue_end_never_overlaps_next_cue_start() {
        let words = vec![w("a.", 0.0, 1.0), w("b.", 0.9, 1.5)];
        let cues = build_cues(&words, &CueOptions::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].end, 0.9);
    }

    #[test]
    fn text_is_sanitized_for_subtitle_syntax() {
        let words = vec![w("line1\nline2", 0.0, 0.5), w("a-->b", 0.5, 0.9)];
        let cues = build_cues(&words, &CueOptions::default());
        assert_eq!(cues[0].text, "line1 line2 a->b");
    }

    #[test]
    fn negative_start_is_clamped_to_zero() {
        let cues = build_cues(&[w("a.", -1.0, 0.5)], &CueOptions::default());
        assert_eq!(cues[0].start, 0.0);
    }

    #[test]
    fn speaker_change_splits_cue_and_label_shows_only_on_change() {
        let opts = CueOptions { include_speakers: true, ..Default::default() };
        let words = vec![
            ws("Hi.", 0.0, 0.4, "speaker_0"),
            ws("There.", 0.5, 0.9, "speaker_0"),
            ws("Yes.", 1.0, 1.4, "speaker_1"),
        ];
        let cues = build_cues(&words, &opts);
        assert_eq!(cues.len(), 3);
        assert_eq!(
            cues.iter().map(|c| c.show_speaker).collect::<Vec<_>>(),
            vec![true, false, true]
        );
    }

    #[test]
    fn speakers_are_ignored_when_option_is_off() {
        let words = vec![ws("Hi", 0.0, 0.3, "speaker_0"), ws("there.", 0.4, 0.8, "speaker_1")];
        let cues = build_cues(&words, &CueOptions::default());
        assert_eq!(texts(&cues), vec!["Hi there."]);
        assert!(!cues[0].show_speaker);
        assert!(cues[0].speaker.is_none());
    }

    #[test]
    fn speaker_labels_are_human_readable() {
        assert_eq!(speaker_label("speaker_0"), "Speaker 1");
        assert_eq!(speaker_label("speaker_11"), "Speaker 12");
        assert_eq!(speaker_label("agent"), "agent");
        assert_eq!(speaker_label("   "), "Speaker");
    }

    // ---- renderers ----

    fn sample_cues() -> Vec<Cue> {
        vec![
            Cue { start: 0.0, end: 1.5, text: "Hello world.".into(), speaker: None, show_speaker: false },
            Cue { start: 2.0, end: 3.25, text: "Bye.".into(), speaker: None, show_speaker: false },
        ]
    }

    #[test]
    fn srt_exact_format() {
        let expected = "1\n00:00:00,000 --> 00:00:01,500\nHello world.\n\n2\n00:00:02,000 --> 00:00:03,250\nBye.\n\n";
        assert_eq!(build_srt(&sample_cues()), expected);
    }

    #[test]
    fn srt_empty_is_empty() {
        assert_eq!(build_srt(&[]), "");
    }

    #[test]
    fn srt_prefixes_speaker_only_when_shown() {
        let cues = vec![
            Cue { start: 0.0, end: 1.0, text: "Hi.".into(), speaker: Some("speaker_0".into()), show_speaker: true },
            Cue { start: 1.0, end: 2.0, text: "Again.".into(), speaker: Some("speaker_0".into()), show_speaker: false },
        ];
        let out = build_srt(&cues);
        assert!(out.contains("[Speaker 1] Hi."));
        assert!(out.contains("\nAgain.\n"));
        assert!(!out.contains("[Speaker 1] Again."));
    }

    #[test]
    fn vtt_exact_format_with_header_and_dot_separator() {
        let expected = "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello world.\n\n00:00:02.000 --> 00:00:03.250\nBye.\n\n";
        assert_eq!(build_vtt(&sample_cues()), expected);
    }

    #[test]
    fn vtt_escapes_markup_characters() {
        let cues = vec![Cue { start: 0.0, end: 1.0, text: "Tom & Jerry <3".into(), speaker: None, show_speaker: false }];
        assert!(build_vtt(&cues).contains("Tom &amp; Jerry &lt;3"));
    }

    #[test]
    fn vtt_with_no_cues_is_just_the_header() {
        assert_eq!(build_vtt(&[]), "WEBVTT\n\n");
    }

    #[test]
    fn txt_groups_paragraphs_by_gap() {
        let cues = vec![
            Cue { start: 0.0, end: 1.0, text: "Hello.".into(), speaker: None, show_speaker: false },
            Cue { start: 1.2, end: 2.0, text: "World.".into(), speaker: None, show_speaker: false },
            Cue { start: 5.0, end: 6.0, text: "Later.".into(), speaker: None, show_speaker: false },
        ];
        assert_eq!(build_txt(&cues), "Hello. World.\n\nLater.\n");
    }

    #[test]
    fn txt_starts_new_paragraph_with_label_on_speaker_change() {
        let cues = vec![
            Cue { start: 0.0, end: 1.0, text: "Hi.".into(), speaker: Some("speaker_0".into()), show_speaker: true },
            Cue { start: 1.1, end: 2.0, text: "Yes.".into(), speaker: Some("speaker_1".into()), show_speaker: true },
        ];
        assert_eq!(build_txt(&cues), "Speaker 1: Hi.\n\nSpeaker 2: Yes.\n");
    }

    #[test]
    fn txt_empty_is_empty() {
        assert_eq!(build_txt(&[]), "");
    }

    // ---- config / key lifecycle ----

    const GOOD_KEY: &str = "sk_1234567890abcdefXYZ9";

    fn ui_cfg() -> TranscriptionConfig {
        StoredTranscriptionConfig::default().to_public()
    }

    #[test]
    fn default_config_is_missing_and_not_ready() {
        let cfg = StoredTranscriptionConfig::default();
        assert_eq!(cfg.key_status, KEY_MISSING);
        assert!(cfg.ensure_ready().unwrap_err().contains("not configured"));
    }

    #[test]
    fn saving_a_key_makes_it_saved_and_ready() {
        let mut cfg = StoredTranscriptionConfig::default();
        cfg.apply_save(&ui_cfg(), Some(GOOD_KEY)).unwrap();
        assert_eq!(cfg.key_status, KEY_SAVED);
        assert_eq!(cfg.ensure_ready().unwrap(), GOOD_KEY);
    }

    #[test]
    fn key_is_trimmed_before_storing() {
        let mut cfg = StoredTranscriptionConfig::default();
        cfg.apply_save(&ui_cfg(), Some(&format!("  {}  ", GOOD_KEY))).unwrap();
        assert_eq!(cfg.api_key.as_deref(), Some(GOOD_KEY));
    }

    #[test]
    fn none_keeps_existing_key_and_empty_clears_it() {
        let mut cfg = StoredTranscriptionConfig::default();
        cfg.apply_save(&ui_cfg(), Some(GOOD_KEY)).unwrap();
        cfg.apply_save(&ui_cfg(), None).unwrap();
        assert_eq!(cfg.key_status, KEY_SAVED);
        cfg.apply_save(&ui_cfg(), Some("   ")).unwrap();
        assert_eq!(cfg.key_status, KEY_MISSING);
        assert!(cfg.api_key.is_none());
    }

    #[test]
    fn invalid_status_blocks_until_a_new_key_is_saved() {
        let mut cfg = StoredTranscriptionConfig::default();
        cfg.apply_save(&ui_cfg(), Some(GOOD_KEY)).unwrap();
        cfg.mark_invalid();
        assert_eq!(cfg.key_status, KEY_INVALID);
        assert!(cfg.ensure_ready().unwrap_err().contains("rejected"));

        // Saving other settings without a new key must NOT revive an invalid key.
        cfg.apply_save(&ui_cfg(), None).unwrap();
        assert_eq!(cfg.key_status, KEY_INVALID);

        cfg.apply_save(&ui_cfg(), Some("sk_brand_new_key_12345")).unwrap();
        assert_eq!(cfg.key_status, KEY_SAVED);
    }

    #[test]
    fn mark_invalid_without_key_stays_missing() {
        let mut cfg = StoredTranscriptionConfig::default();
        cfg.mark_invalid();
        assert_eq!(cfg.key_status, KEY_MISSING);
    }

    #[test]
    fn ui_cannot_forge_key_status() {
        let mut cfg = StoredTranscriptionConfig::default();
        let mut incoming = ui_cfg();
        incoming.key_status = KEY_SAVED.to_string();
        cfg.apply_save(&incoming, None).unwrap();
        assert_eq!(cfg.key_status, KEY_MISSING);
    }

    #[test]
    fn malformed_keys_are_rejected_without_changing_state() {
        let mut cfg = StoredTranscriptionConfig::default();
        cfg.apply_save(&ui_cfg(), Some(GOOD_KEY)).unwrap();
        for bad in ["short", "has space inside key", "tab\tinside_key_123", "new\nline_key_12345", "ключ_юникод_12345"] {
            let err = cfg.apply_save(&ui_cfg(), Some(bad)).unwrap_err();
            assert!(!err.contains(bad), "error must not echo the key");
        }
        assert_eq!(cfg.api_key.as_deref(), Some(GOOD_KEY));
    }

    #[test]
    fn public_config_never_contains_the_key() {
        let mut cfg = StoredTranscriptionConfig::default();
        cfg.apply_save(&ui_cfg(), Some(GOOD_KEY)).unwrap();
        let public = cfg.to_public();
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("1234567890"));
        assert!(!json.contains(GOOD_KEY));
        assert_eq!(public.api_key_hint.as_deref(), Some("••••XYZ9"));
        assert_eq!(public.key_status, KEY_SAVED);
    }

    #[test]
    fn short_keys_are_fully_masked() {
        assert_eq!(mask_key("abcdefgh"), "••••");
    }

    #[test]
    fn debug_output_redacts_the_key() {
        let mut cfg = StoredTranscriptionConfig::default();
        cfg.apply_save(&ui_cfg(), Some(GOOD_KEY)).unwrap();
        let dbg = format!("{:?}", cfg);
        assert!(!dbg.contains("1234567890"));
        assert!(dbg.contains("<redacted>"));
    }

    #[test]
    fn language_and_model_and_provider_are_validated() {
        let mut cfg = StoredTranscriptionConfig::default();

        let mut c = ui_cfg();
        c.language_code = Some("ID".into());
        cfg.apply_save(&c, None).unwrap();
        assert_eq!(cfg.language_code.as_deref(), Some("id"));

        c.language_code = Some("  ".into());
        cfg.apply_save(&c, None).unwrap();
        assert!(cfg.language_code.is_none());

        c.language_code = Some("english".into());
        assert!(cfg.apply_save(&c, None).is_err());
        c.language_code = Some("e1".into());
        assert!(cfg.apply_save(&c, None).is_err());
        c.language_code = None;

        c.model_id = "Scribe V2; DROP".into();
        assert!(cfg.apply_save(&c, None).is_err());
        c.model_id = "scribe_v2".into();

        c.provider = "other".into();
        assert!(cfg.apply_save(&c, None).is_err());
    }

    #[test]
    fn failed_save_is_atomic() {
        let mut cfg = StoredTranscriptionConfig::default();
        let mut c = ui_cfg();
        c.diarize = true;
        c.language_code = Some("zz9".into()); // invalid
        assert!(cfg.apply_save(&c, Some(GOOD_KEY)).is_err());
        assert!(!cfg.diarize);
        assert!(cfg.api_key.is_none());
    }

    #[test]
    fn max_chars_is_clamped() {
        let mut cfg = StoredTranscriptionConfig::default();
        let mut c = ui_cfg();
        c.max_chars_per_line = 5;
        cfg.apply_save(&c, None).unwrap();
        assert_eq!(cfg.max_chars_per_line, 20);
        c.max_chars_per_line = 500;
        cfg.apply_save(&c, None).unwrap();
        assert_eq!(cfg.max_chars_per_line, 80);
    }

    #[test]
    fn normalize_repairs_inconsistent_stored_state() {
        let mut cfg = StoredTranscriptionConfig::default();
        cfg.key_status = KEY_SAVED.to_string();
        cfg.api_key = None;
        cfg.normalize();
        assert_eq!(cfg.key_status, KEY_MISSING);

        cfg.api_key = Some(GOOD_KEY.to_string());
        cfg.key_status = "garbage".to_string();
        cfg.normalize();
        assert_eq!(cfg.key_status, KEY_SAVED);
    }

    #[test]
    fn config_roundtrips_through_database() {
        let db = Database::new_in_memory().unwrap();
        assert_eq!(load_config(&db).unwrap().key_status, KEY_MISSING);

        let mut cfg = StoredTranscriptionConfig::default();
        cfg.apply_save(&ui_cfg(), Some(GOOD_KEY)).unwrap();
        cfg.diarize = true;
        save_config(&db, &cfg).unwrap();

        let loaded = load_config(&db).unwrap();
        assert_eq!(loaded.api_key.as_deref(), Some(GOOD_KEY));
        assert_eq!(loaded.key_status, KEY_SAVED);
        assert!(loaded.diarize);
    }

    #[test]
    fn corrupt_stored_json_falls_back_to_defaults() {
        let db = Database::new_in_memory().unwrap();
        db.set_setting(SETTINGS_KEY, "{not json").unwrap();
        let cfg = load_config(&db).unwrap();
        assert_eq!(cfg.key_status, KEY_MISSING);
        assert!(cfg.api_key.is_none());
    }

    #[test]
    fn settings_and_record_helpers_work() {
        let db = Database::new_in_memory().unwrap();
        assert!(db.get_setting("nope").unwrap().is_none());
        db.set_setting("k", "v1").unwrap();
        db.set_setting("k", "v2").unwrap();
        assert_eq!(db.get_setting("k").unwrap().as_deref(), Some("v2"));
        assert!(db.get_record_status_path("missing").unwrap().is_none());
    }

    #[test]
    fn key_check_classification() {
        assert_eq!(classify_key_check(200), KeyCheckOutcome::Valid);
        assert_eq!(classify_key_check(401), KeyCheckOutcome::Rejected);
        assert_eq!(classify_key_check(403), KeyCheckOutcome::Inconclusive(403));
        assert_eq!(classify_key_check(500), KeyCheckOutcome::Inconclusive(500));
    }
}
