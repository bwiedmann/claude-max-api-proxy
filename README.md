# Claude Code CLI Provider

**Use your Claude Max subscription ($200/month) with any OpenAI-compatible client — no separate API costs!**

This provider wraps the Claude Code CLI as a subprocess and exposes an OpenAI-compatible HTTP API, allowing tools like Clawdbot, Continue.dev, or any OpenAI-compatible client to use your Claude Max subscription instead of paying per-API-call.

## Why This Exists

| Approach | Cost | Limitation |
|----------|------|------------|
| Claude API | ~$15/M input, ~$75/M output tokens | Pay per use |
| Claude Max | $200/month flat | OAuth blocked for third-party API use |
| **This Provider** | $0 extra (uses Max subscription) | Routes through CLI |

Anthropic blocks OAuth tokens from being used directly with third-party API clients. However, the Claude Code CLI *can* use OAuth tokens. This provider bridges that gap by wrapping the CLI and exposing a standard API.

## How It Works

```
Your App (Clawdbot, etc.)
         ↓
    HTTP Request (OpenAI format)
         ↓
   Claude Code CLI Provider (this project)
         ↓
   Claude Code CLI (subprocess)
         ↓
   OAuth Token (from Max subscription)
         ↓
   Anthropic API
         ↓
   Response → OpenAI format → Your App
```

## Features

- **OpenAI-compatible API** — Works with any client that supports OpenAI's API format
- **Streaming support** — Real-time token streaming via Server-Sent Events
- **Multiple models** — Claude Opus, Sonnet, and Haiku
- **Session management** — Maintains conversation context
- **Auto-start service** — Optional LaunchAgent for macOS
- **Zero configuration** — Uses existing Claude CLI authentication
- **Secure by design** — Uses spawn() to prevent shell injection

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
git clone https://github.com/anthropics/claude-code-cli-provider.git
cd claude-code-cli-provider

# Install dependencies
npm install

# Build
npm run build
```

## Usage

### Start the server

```bash
node dist/server/standalone.js
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
    "model": "claude-opus-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Chat completion (streaming)
curl -N -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4",
    "messages": [{"role": "user", "content": "Hello!"}],
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

| Model ID | Maps To |
|----------|---------|
| `claude-opus-4` | Claude Opus 4.5 |
| `claude-sonnet-4` | Claude Sonnet 4 |
| `claude-haiku-4` | Claude Haiku 4 |

## Configuration with Popular Tools

### Clawdbot

Clawdbot has **built-in support** for Claude CLI OAuth! Check your config:

```bash
clawdbot models status
```

If you see `anthropic:claude-cli=OAuth`, you're already using your Max subscription.

### Continue.dev

Add to your Continue config:

```json
{
  "models": [{
    "title": "Claude (Max)",
    "provider": "openai",
    "model": "claude-opus-4",
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
    model="claude-opus-4",
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

Create a LaunchAgent to start the provider automatically on login. See `docs/macos-setup.md` for detailed instructions.

## Architecture

```
src/
├── types/
│   ├── claude-cli.ts      # Claude CLI JSON output types
│   └── openai.ts          # OpenAI API types
├── adapter/
│   ├── openai-to-cli.ts   # Convert OpenAI requests → CLI format
│   └── cli-to-openai.ts   # Convert CLI responses → OpenAI format
├── subprocess/
│   └── manager.ts         # Claude CLI subprocess management
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
- Prompts passed as CLI arguments, not through shell interpretation

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

## Contributing

Contributions welcome! Please submit PRs with tests.

## License

MIT

## Acknowledgments

- Built for use with [Clawdbot](https://clawd.bot)
- Powered by [Claude Code CLI](https://github.com/anthropics/claude-code)
