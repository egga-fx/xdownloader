---
title: "API Authentication"
site: "ElevenLabs Documentation"
source: "https://elevenlabs.io/docs/api-reference/authentication"
domain: "elevenlabs.io"
language: "en"
description: "Learn how to authenticate your ElevenLabs API requests"
word_count: 232
---

## API Keys

The ElevenLabs API uses API keys for authentication. Every request to the API must include your API key, used to authenticate your requests and track usage quota.

Each API key can be configured with the following restrictions:

1. **Scope restriction:** Set access restrictions by limiting which API endpoints the key can access.
2. **Credit quota:** Define custom credit limits to control usage.
3. **IP allowlisting:** Restrict the key to specific IP addresses or CIDR ranges. Requests from non-allowlisted IPs are rejected with a `403` error. [Learn more](https://elevenlabs.io/docs/overview/administration/workspaces/api-keys#ip-allowlisting).

**Remember that your API key is a secret.** Do not share it with others or expose it in any client-side code (browsers, apps).

All API requests should include your API key in an `xi-api-key` HTTP header as follows:

```bash
xi-api-key: ELEVENLABS_API_KEY
```

### Making requests

You can paste the command below into your terminal to run your first API request. Make sure to replace `$ELEVENLABS_API_KEY` with your secret API key.

```bash
curl 'https://api.elevenlabs.io/v1/models' \
```

Example with the `elevenlabs` Python package:

```python
from elevenlabs.client import ElevenLabs
```

Example with the `elevenlabs` Node.js package:

```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
```

### Single use tokens

For certain endpoints, you can use single use tokens to authenticate your requests. These tokens are valid for a limited time and can be used to connect to the API without exposing your API key, for example from the client side.

See the [Single use tokens](https://elevenlabs.io/docs/api-reference/tokens/create) documentation for more information.