# Claude Max API Proxy

**Use your Claude Max subscription ($200/month) with any OpenAI-compatible client — no separate API costs!**

This proxy wraps the Claude Code CLI as a subprocess and exposes an OpenAI-compatible HTTP API, allowing tools like OpenClaw, Continue.dev, or any OpenAI-compatible client to use your Claude Max subscription instead of paying per-API-call.

> **Fork note:** This is an actively maintained fork of [atalovesyou/claude-max-api-proxy](https://github.com/atalovesyou/claude-max-api-proxy) with additional features and bug fixes. See [What's Different](#whats-different-in-this-fork) below.

## Why This Exists

| Approach | Cost | Limitation |
|----------|------|------------|
| Claude API | ~$15/M input, ~$75/M output tokens | Pay per use |
| Claude Max | $200/month flat | OAuth blocked for third-party API use |
| **This Proxy** | $0 extra (uses Max subscription) | Routes through CLI |

Anthropic blocks OAuth tokens from being used directly with third-party API clients. However, the Claude Code CLI *can* use OAuth tokens. This proxy bridges that gap by wrapping the CLI and exposing a standard API.

## How It Works

```
Your App (OpenClaw, Continue.dev, etc.)
         ↓
    HTTP Request (OpenAI format)
         ↓
   Claude Max API Proxy (this project)
         ↓
   Claude Code CLI (subprocess, prompt via stdin)
         ↓
   OAuth Token (from Max subscription)
         ↓
   Anthropic API
         ↓
   Response → OpenAI format → Your App
```

## Features

- **OpenAI-compatible API** — Works with any client that supports OpenAI's API format
- **Streaming support** — Real-time token streaming via Server-Sent Events (with usage data)
- **Multiple models** — Claude Opus 4.6, Sonnet 4.5, Opus 4, Sonnet 4, and Haiku 4
- **System prompt support** — Passes system/developer messages via `--append-system-prompt`
- **Session management** — Maintains conversation context
- **Auto-start service** — Optional LaunchAgent for macOS
- **Zero configuration** — Uses existing Claude CLI authentication
- **Secure by design** — Uses spawn() + stdin to prevent shell injection and E2BIG errors
- **Debug logging** — Optional `DEBUG_SUBPROCESS=true` for troubleshooting

## Prerequisites

1. **Claude Max subscription** ($200/month) — [Subscribe here](https://claude.ai)
2. **Claude Code CLI** installed and authenticated:
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude auth login
   ```

## Installation

```bash
# Clone the repository
git clone https://github.com/smartchainark/claude-max-api-proxy.git
cd claude-max-api-proxy

# Install dependencies
npm install

# Build
npm run build

# (Optional) Install as global command
npm link
```

## Usage

### Start the server

```bash
node dist/server/standalone.js
# or if installed globally:
claude-max-api
```

The server runs at `http://localhost:3456` by default.

### Test it

```bash
# Health check
curl http://localhost:3456/health

# List models
curl http://localhost:3456/v1/models

# Chat completion (non-streaming)
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Chat completion (streaming)
curl -N -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-6",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# With system prompt
curl -N -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "stream": true
  }'
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | Chat completions (streaming & non-streaming) |

## Available Models

| Model ID | Maps To | Notes |
|----------|---------|-------|
| `claude-opus-4-6` | Claude Opus 4.6 | Latest, most capable |
| `claude-opus-4` | Claude Opus 4 | |
| `claude-sonnet-4-5` | Claude Sonnet 4.5 | Fast and capable |
| `claude-sonnet-4` | Claude Sonnet 4 | |
| `claude-haiku-4` | Claude Haiku 4 | Fastest |

### Model aliases

The proxy also accepts prefixed model names for compatibility with different clients:

| Prefix | Example | Maps To |
|--------|---------|---------|
| `claude-max/` | `claude-max/claude-opus-4-6` | `opus` |
| `claude-code-cli/` | `claude-code-cli/claude-sonnet-4-5` | `sonnet` |
| (none) | `opus-max`, `sonnet-max` | `opus`, `sonnet` |

## Configuration with Popular Tools

### OpenClaw / Clawdbot

Add the following to your `~/.openclaw/openclaw.json` (or equivalent config file):

```json
{
  "models": {
    "providers": {
      "claude-max-proxy": {
        "baseUrl": "http://localhost:3456/v1",
        "apiKey": "not-needed",
        "api": "openai-completions",
        "models": [
          {
            "id": "claude-opus-4",
            "name": "Claude Opus 4 (via Max Proxy)",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 32000
          },
          {
            "id": "claude-sonnet-4",
            "name": "Claude Sonnet 4 (via Max Proxy)",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 32000
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "claude-max-proxy/claude-opus-4"
      },
      "models": {
        "claude-max-proxy/claude-opus-4": { "alias": "opus4" },
        "claude-max-proxy/claude-sonnet-4": { "alias": "sonnet4" }
      }
    }
  }
}
```

**Important:** Make sure the proxy server is running before starting OpenClaw:
```bash
claude-max-api  # or: node dist/server/standalone.js
```

### OpenClaw

```json
{
  "providers": {
    "claude-max": {
      "baseUrl": "http://127.0.0.1:3456/v1",
      "apiKey": "not-needed",
      "api": "openai-completions",
      "models": [
        { "id": "claude-opus-4-6", "name": "Claude Opus 4.6 (Max)" },
        { "id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5 (Max)" },
        { "id": "claude-haiku-4", "name": "Claude Haiku 4 (Max)" }
      ]
    }
  }
}
```

### Continue.dev

```json
{
  "models": [{
    "title": "Claude Opus 4.6 (Max)",
    "provider": "openai",
    "model": "claude-opus-4-6",
    "apiBase": "http://localhost:3456/v1",
    "apiKey": "not-needed"
  }]
}
```

### Generic OpenAI Client (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="not-needed"  # Any value works
)

response = client.chat.completions.create(
    model="claude-opus-4-6",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### OpenClaw (Docker)

When running this provider in Docker, point OpenClaw at the host IP and mapped port:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "claude-proxy": {
        "baseUrl": "http://<ip>:3456/v1",
        "apiKey": "proxy",
        "api": "openai-completions",
        "models": [
          {
            "id": "claude-sonnet-4",
            "name": "claude-sonnet-4",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

## Auto-Start on macOS

Create a LaunchAgent to start the proxy automatically on login:

```xml
<!-- ~/Library/LaunchAgents/com.claude-max-api-proxy.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-max-api-proxy</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/node</string>
        <string>/path/to/claude-max-api-proxy/dist/server/standalone.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

## What's Different in This Fork

Compared to the [original repo](https://github.com/atalovesyou/claude-max-api-proxy):

| Feature | Original | This Fork |
|---------|----------|-----------|
| Streaming usage data | Missing | Included in final SSE chunk |
| System prompt | Embedded in user prompt | Via `--append-system-prompt` flag |
| Prompt delivery | CLI argument (E2BIG risk) | stdin (no size limit) |
| Model support | Opus 4, Sonnet 4, Haiku 4 | + Opus 4.6, Sonnet 4.5 |
| Model prefixes | `claude-code-cli/` only | + `claude-max/`, aliases |
| Undefined model crash | Crashes on rate limit | Graceful fallback |
| Debug logging | Always on (noisy) | Opt-in via `DEBUG_SUBPROCESS` |
| Permissions | Requires confirmation | `--dangerously-skip-permissions` for service mode |
| Array content | Not supported | Handles string and array content parts |

Community PRs incorporated: [#7](https://github.com/atalovesyou/claude-max-api-proxy/pull/7), [#10](https://github.com/atalovesyou/claude-max-api-proxy/pull/10), [#12](https://github.com/atalovesyou/claude-max-api-proxy/pull/12).

## Architecture

```
src/
├── types/
│   ├── claude-cli.ts      # Claude CLI JSON output types
│   └── openai.ts          # OpenAI API types (with multimodal content parts)
├── adapter/
│   ├── openai-to-cli.ts   # Convert OpenAI requests → CLI format
│   └── cli-to-openai.ts   # Convert CLI responses → OpenAI format
├── subprocess/
│   └── manager.ts         # Claude CLI subprocess management (stdin-based)
├── session/
│   └── manager.ts         # Session ID mapping
├── server/
│   ├── index.ts           # Express server setup
│   ├── routes.ts          # API route handlers
│   └── standalone.ts      # Entry point
└── index.ts               # Package exports
```

## Security

- Uses Node.js `spawn()` instead of shell execution to prevent injection attacks
- No API keys stored or transmitted by this provider
- All authentication handled by Claude CLI's secure keychain storage
- Prompts passed via stdin, not through shell interpretation

## Cost Savings Example

| Usage | API Cost | With This Provider |
|-------|----------|-------------------|
| 1M input tokens/month | ~$15 | $0 (included in Max) |
| 500K output tokens/month | ~$37.50 | $0 (included in Max) |
| **Monthly Total** | **~$52.50** | **$0 extra** |

If you're already paying for Claude Max, this provider lets you use that subscription for API-style access at no additional cost.

## Docker (Recommended)

This project ships with a production-ready Docker image that includes Claude CLI and keeps all data, config, and auth secrets on a persistent volume. The container itself remains stateless and safe to replace.

### Build

```bash
docker build -t claude-max-api-proxy:latest .
```

### One-time Claude CLI login (persists on volume)

Claude CLI uses OAuth. You must run the login once, then the credentials are stored on the volume and survive container upgrades.

```bash
docker run --rm -it \
  -v claudeproxy_data:/data \
  claude-max-api-proxy:latest \
  claude auth login
```

### Run

```bash
docker run -d --name claudeproxy \
  -p 3456:3456 \
  -v claudeproxy_data:/data \
  claude-max-api-proxy:latest
```

### Custom Port

```bash
docker run -d --name claudeproxy \
  -e PORT=8080 -p 8080:8080 \
  -v claudeproxy_data:/data \
  claude-max-api-proxy:latest
```

### Docker Compose

```bash
docker compose up -d --build
```

Edit `docker-compose.yml` to change the exposed port.

### Where data, config, and secrets live

All runtime state is redirected to `/data` inside the container and should be mounted to a persistent volume:

- `HOME=/data`
- `XDG_CONFIG_HOME=/data/.config`
- `XDG_DATA_HOME=/data/.local/share`
- `XDG_STATE_HOME=/data/.local/state`
- `XDG_CACHE_HOME=/data/.cache`

This ensures:
- Claude CLI OAuth secrets persist across container updates.
- Session mappings (`.claude-code-cli-sessions.json`) persist.
- The container filesystem stays stateless.

### Logs

By default, logs go to stdout/stderr (preferred for container environments and avoids disk growth).
If you want file logs on the volume:

```bash
docker run -d --name claudeproxy \
  -e LOG_DIR=/data/logs \
  -p 3456:3456 \
  -v claudeproxy_data:/data \
  claude-max-api-proxy:latest
```

### Health Check

```bash
curl http://localhost:3456/health
```

## Troubleshooting

### "Claude CLI not found"

Install and authenticate the CLI:
```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

### Streaming returns immediately with no content

Ensure you're using `-N` flag with curl (disables buffering):
```bash
curl -N -X POST http://localhost:3456/v1/chat/completions ...
```

### Server won't start

Check that the Claude CLI is in your PATH:
```bash
which claude
```

### Enable debug logging

To troubleshoot subprocess issues, enable detailed debug logging:
```bash
DEBUG_SUBPROCESS=true node dist/server/standalone.js
```

This will log:
- Subprocess spawn events and PIDs
- Stdout/stderr data flow
- System prompt content
- Assistant messages and results
- Process exit codes

## Cost Savings Example

| Usage | API Cost | With This Provider |
|-------|----------|-------------------|
| 1M input tokens/month | ~$15 | $0 (included in Max) |
| 500K output tokens/month | ~$37.50 | $0 (included in Max) |
| **Monthly Total** | **~$52.50** | **$0 extra** |

If you're already paying for Claude Max, this provider lets you use that subscription for API-style access at no additional cost.

## Security

- Uses Node.js `spawn()` instead of shell execution to prevent injection attacks
- Prompts passed via stdin, not through shell interpretation or CLI arguments
- No API keys stored or transmitted by this proxy
- All authentication handled by Claude CLI's secure keychain storage

## Contributing

Contributions welcome! Please submit PRs with tests.

## License

MIT

## Acknowledgments

- Originally created by [atalovesyou](https://github.com/atalovesyou/claude-max-api-proxy)
- Built for use with [Clawdbot](https://clawd.bot)
- Community contributors: [@wende](https://github.com/wende), [@kevinfealey](https://github.com/kevinfealey), [@jamshehan](https://github.com/jamshehan)
- Powered by [Claude Code CLI](https://github.com/anthropics/claude-code)
