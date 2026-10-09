---
title: "Speech to Text quickstart"
site: "ElevenLabs Documentation"
source: "https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-to-text"
domain: "elevenlabs.io"
language: "en"
description: "Learn how to convert spoken audio into text."
word_count: 396
---

This guide will show you how to convert spoken audio into text using the Speech to Text API.

Use the [ElevenLabs speech-to-text skill](https://github.com/elevenlabs/skills/tree/main/speech-to-text) to transcribe audio from your AI coding assistant:

```bash
npx skills add elevenlabs/skills --skill speech-to-text
```

This tutorial will demonstrate how to use the Batch Speech to Text API. For a guide on how to use the Realtime Speech to Text API, see the [Client-side streaming](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming) or [Server-side streaming](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/server-side-streaming) guides.

## Using the Speech to Text API

[^1]

### Create an API key

[Create an API key in the dashboard here](https://elevenlabs.io/app/settings/api-keys), which you’ll use to securely [access the API](https://elevenlabs.io/docs/api-reference/authentication).

Store the key as a managed secret and pass it to the SDKs either as a environment variable via an `.env` file, or directly in your app’s configuration depending on your preference.

```js
ELEVENLABS_API_KEY=<your_api_key_here>
```

[^2]

### Install the SDK

###### SDK

###### CLI

We’ll also use the `dotenv` library to load our API key from an environment variable.

```python
pip install elevenlabs
```

[^3]

### Make the API request

###### SDK

###### CLI

Create a new file named `example.py` or `example.mts`, depending on your language of choice and add the following code:

```python
# example.py
```

Then run it:

```python
python example.py
```

You should see the transcription of the audio file printed to the console.

For medical and clinical audio, set `model_id` to `scribe_v2_medical`. The request shape is the same as `scribe_v2` and is billed at the same rate. See [Scribe v2 Medical](https://elevenlabs.io/docs/overview/models#scribe-v2-medical).

## Next steps

[^1]: [1](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-to-text#create-an-api-key)

### Create an API key

[Create an API key in the dashboard here](https://elevenlabs.io/app/settings/api-keys), which you’ll use to securely [access the API](https://elevenlabs.io/docs/api-reference/authentication).

Store the key as a managed secret and pass it to the SDKs either as a environment variable via an `.env` file, or directly in your app’s configuration depending on your preference.

```js
ELEVENLABS_API_KEY=<your_api_key_here>
```

[^2]: [2](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-to-text#install-the-sdk)

### Install the SDK

###### SDK

###### CLI

We’ll also use the `dotenv` library to load our API key from an environment variable.

```python
pip install elevenlabs
```

[^3]: [3](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-to-text#make-the-api-request)

### Make the API request

###### SDK

###### CLI

Create a new file named `example.py` or `example.mts`, depending on your language of choice and add the following code:

```python
# example.py
```

Then run it:

```python
python example.py
```

You should see the transcription of the audio file printed to the console.

For medical and clinical audio, set `model_id` to `scribe_v2_medical`. The request shape is the same as `scribe_v2` and is billed at the same rate. See [Scribe v2 Medical](https://elevenlabs.io/docs/overview/models#scribe-v2-medical).