# scry-mcp

MCP (Model Context Protocol) server for the Scry corpus. Wraps the [scry-api](https://github.com/TunnelMind/scry-api) public endpoints as agent-callable tools.

Hosted at `mcp.tunnelmind.ai`. MCP spec version `2025-03-26`. Streamable HTTP transport.

## Tools (v0.1)

| Tool         | Wraps                          | Tier  |
|--------------|--------------------------------|-------|
| `scry_check` | `GET /v1/check/{ip}`           | Free  |

Future tools (deferred to defender tier; need ATAP attestation):
- `scry_watch` — subscribe to state changes for an IP/domain
- `scry_actor` — full actor profile
- `scry_campaign` — campaign detail

## Wire protocol

```
POST https://mcp.tunnelmind.ai/mcp
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"initialize"}
```

Methods:
- `initialize` — handshake, returns `{ protocolVersion, capabilities, serverInfo }`
- `notifications/initialized` — client → server notification (returns 204)
- `tools/list` — returns `{ tools: [...] }`
- `tools/call` — `{ name, arguments }` → `{ content: [{ type: "text", text }] }`
- `ping` — returns `{}`

Discovery:
```
GET https://mcp.tunnelmind.ai/
→ { service, version, protocol, transport, endpoint, tools }
```

## Layout

```
src/
  worker.js   transport (JSON-RPC 2.0 over POST /mcp)
  tools.js    tool definitions + handlers
test/
  tools.test.js   unit tests for tool registry
```

## Setup

```bash
npm test
npx wrangler deploy
```

No bindings, no secrets — this Worker is a thin proxy with no state.
