---
title: "Create transcript"
site: "ElevenLabs Documentation"
source: "https://elevenlabs.io/docs/api-reference/speech-to-text/convert"
domain: "elevenlabs.io"
language: "en"
description: "Transcribe an audio or video file. If webhook is set to true, the request will be processed asynchronously and results sent to configured webhooks."
word_count: 1389
---

Transcribe an audio or video file. If webhook is set to true, the request will be processed asynchronously and results sent to configured webhooks. When use\_multi\_channel is true and the provided audio has multiple channels, a ‘transcripts’ object with separate transcripts for each channel is returned; set multichannel\_output\_style=‘combined’ to instead receive a single transcript with all channels merged and sorted by time. Otherwise, returns a single transcript. The optional webhook\_metadata parameter allows you to attach custom data that will be included in webhook responses for request correlation and tracking.

### Headers

xi-api-keystringOptional

### Query parameters

tokenstring or nullOptional

A single-use authentication token created via POST /v1/single-use-token/batch\_scribe. This token can only be used once and expires after 15 minutes. Alternative to API key or bearer token authentication for frontend clients.

enable\_loggingbooleanOptionalDefaults to `true`

When enable\_logging is set to false zero retention mode will be used for the request. This will mean log and transcript storage features are unavailable for this request. Zero retention mode may only be used by enterprise customers.

### Request

This endpoint expects a multipart form containing an optional file.

model\_idstringRequired

The ID of the model to use for transcription.

filefileOptional

The file to transcribe (100ms minimum audio length). All major audio and video formats are supported. Exactly one of the file or cloud\_storage\_url parameters must be provided. The file size must be less than 5.0GB.

language\_codestring or nullOptional

An ISO-639-1 or ISO-639-3 language\_code corresponding to the language of the audio file. Can sometimes improve transcription performance if known beforehand. Defaults to null, in this case the language is predicted automatically.

transcript\_editstring or nullOptional

Natural-language instruction applied to the final transcript (max 2000 characters). The edited text is returned in ‘edited\_transcript’ alongside the original transcript. Cannot be combined with entity\_detection, entity\_redaction or use\_multi\_channel. Usage of this parameter will incur an additional 30% surcharge on the base transcription cost, billed for at least 10 seconds of audio.

tag\_audio\_eventsbooleanOptionalDefaults to `true`

Whether to tag audio events like (laughter), (footsteps), etc. in the transcription.

num\_speakersinteger or nullOptional`1-32`

The maximum amount of speakers talking in the uploaded file. Can help with predicting who speaks when. The maximum amount of speakers that can be predicted is 32. Defaults to null, in this case the amount of speakers is set to the maximum value the model supports.

diarizebooleanOptionalDefaults to `false`

Whether to annotate which speaker is currently talking in the uploaded file.

diarization\_thresholddouble or nullOptional`0.1-0.4`

Diarization threshold to apply during speaker diarization. A higher value means there will be a lower chance of one speaker being diarized as two different speakers but also a higher chance of two different speakers being diarized as one speaker (less total speakers predicted). A low value means there will be a higher chance of one speaker being diarized as two different speakers but also a lower chance of two different speakers being diarized as one speaker (more total speakers predicted). Can only be set when diarize=True and num\_speakers=None. Defaults to None, in which case we will choose a threshold based on the model\_id (0.22 usually).

additional\_formatslist of objectsOptional

A list of additional formats to export the transcript to.

file\_formatenumOptionalDefaults to `other`

The format of input audio. Options are ‘pcm\_s16le\_16’ or ‘other’ For `pcm_s16le_16`, the input audio must be 16-bit PCM at a 16kHz sample rate, single channel (mono), and little-endian byte order. Latency will be lower than with passing an encoded waveform.

Allowed values:pcm\_s16le\_16other

cloud\_storage\_urlstring or nullOptional Deprecated

\[Deprecated\] This parameter is deprecated and will be removed in the future. Use ‘source\_url’ instead.The HTTPS URL of the file to transcribe. Exactly one of the file or cloud\_storage\_url parameters must be provided. The file must be accessible via HTTPS and the file size must be less than 2GB. Any valid HTTPS URL is accepted, including URLs from cloud storage providers (AWS S3, Google Cloud Storage, Cloudflare R2, etc.), CDNs, or any other HTTPS source. URLs can be pre-signed or include authentication tokens in query parameters.

source\_urlstring or nullOptional

The URL of an audio or video file to transcribe. Supports hosted video or audio files, YouTube video URLs, TikTok video URLs, and other video hosting services.

webhookbooleanOptionalDefaults to `false`

Whether to send the transcription result to configured speech-to-text webhooks. If set the request will return early without the transcription, which will be delivered later via webhook.

webhook\_idstring or nullOptional

Optional specific webhook ID to send the transcription result to. Only valid when webhook is set to true. If not provided, transcription will be sent to all configured speech-to-text webhooks.

temperaturedouble or nullOptional`0-2`

Controls the randomness of the transcription output. Accepts values between 0.0 and 2.0, where higher values result in more diverse and less deterministic results. If omitted, we will use a temperature based on the model you selected which is usually 0.

seedinteger or nullOptional`0-2147483647`

If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result. Determinism is not guaranteed. Must be an integer between 0 and 2147483647.

use\_multi\_channelbooleanOptionalDefaults to `false`

Whether the audio file contains multiple channels where each channel contains a single speaker. When enabled, each channel is transcribed independently. By default a separate transcript is returned per channel; set multichannel\_output\_style=‘combined’ to instead receive a single transcript with all channels merged and sorted by time. Each word in the response includes a ‘channel\_index’ field indicating which channel it was spoken on. A maximum of 5 channels is supported. Each channel is billed independently at the full audio duration, so cost scales linearly with the number of channels.

multichannel\_output\_styleenumOptionalDefaults to `separate`

Controls the response shape when use\_multi\_channel is enabled. ‘separate’ (default) returns one transcript per channel under ‘transcripts’. ‘combined’ merges all channels into a single transcript whose words are sorted by start time, each carrying a ‘channel\_index’ - matching the single-channel response shape. ‘combined’ requires timestamps (timestamps\_granularity must not be ‘none’) and does not support entity detection or redaction.

Allowed values:separatecombined

entity\_detectionstring or list of strings or nullOptional

Detect entities in the transcript. Can be ‘all’ to detect all entities, a single entity type or category string, or a list of entity types/categories. Categories include ‘pii’, ‘phi’, ‘pci’, ‘other’, ‘offensive\_language’. When enabled, detected entities will be returned in the ‘entities’ field with their text, type, and character positions. Usage of this parameter will incur an additional 30% surcharge on the base transcription cost.

no\_verbatimbooleanOptionalDefaults to `false`

If true, the transcription will not have any filler words, false starts and non-speech sounds. Only supported with scribe\_v2 model.

use\_speaker\_librarybooleanOptionalDefaults to `false`

Whether to use the speaker library for identifying known speakers during diarization. When enabled and diarize is true, detected speakers will be matched against registered speakers in the workspace's speaker library.

detect\_speaker\_rolesbooleanOptionalDefaults to `false`

Whether to detect speaker roles (agent vs customer). Requires diarize=true. Cannot be used with use\_multi\_channel=true. When enabled, speaker\_id values will be ‘agent’ and ‘customer’ instead of ‘speaker\_0’, ‘speaker\_1’, etc. Usage incurs an additional 10% surcharge on base transcription cost.

entity\_redactionstring or list of strings or nullOptional

Redact entities from the transcript text. Accepts the same format as entity\_detection: ‘all’, a category (‘pii’, ‘phi’), or specific entity types. Must be a subset of entity\_detection. When redaction is enabled, the entities field will not be returned. Usage of this parameter will incur an additional 30% surcharge on the base transcription cost.

entity\_redaction\_modestringOptionalDefaults to `enumerated_entity_type`

How to format redacted entities. ‘redacted’ replaces with {REDACTED}, ‘entity\_type’ replaces with {ENTITY\_TYPE}, ‘enumerated\_entity\_type’ replaces with {ENTITY\_TYPE\_N} where N enumerates each occurrence. Only used when entity\_redaction is set.

keytermslist of stringsOptionalDefaults to `[]`

A list of keyterms to bias the transcription towards. The keyterms are words or phrases you want the model to recognise more accurately. The number of keyterms cannot exceed 1000. The length of each keyterm must be less than 50 characters. Keyterms can contain at most 5 words (after normalisation). For example \[“hello”, “world”, “technical term”\]. The following characters are not supported: `<`, `>`, `{`, `}`, `[`, `]`, `\`. Usage of this parameter will incur an additional 20% surcharge on the base transcription cost. When more than 100 keyterms are provided, a minimum billable duration of 20 seconds applies per request.

### Response

Synchronous transcription result

SpeechToTextChunkResponseModelobject

Chunk-level detail of the transcription with timing information.

OR

MultichannelSpeechToTextResponseModelobject

Response model for multichannel speech-to-text transcription.

OR

SpeechToTextWebhookResponseModelobject