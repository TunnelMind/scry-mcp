// Scry MCP server (Streamable HTTP transport, MCP spec 2025-03-26).
//
// Endpoint: POST /mcp — JSON-RPC 2.0 envelope.
// Methods supported: initialize, tools/list, tools/call.
// Plus GET /  for browser-friendly service descriptor.

import { findTool, listToolsForResponse, TOOLS } from "./tools.js";

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "scry", version: "0.1.0" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const { pathname } = url;

    if (method === "GET" && (pathname === "/" || pathname === "")) {
      return jsonResponse({
        service: "scry-mcp",
        version: SERVER_INFO.version,
        protocol: PROTOCOL_VERSION,
        transport: "streamable-http",
        endpoint: "POST /mcp",
        tools: TOOLS.map((t) => t.name),
      });
    }

    if (method === "POST" && pathname === "/mcp") {
      return handleMcp(request, env);
    }

    return jsonResponse({ error: "not found" }, 404);
  },
};

async function handleMcp(request, env) {
  let req;
  try {
    req = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "parse error");
  }

  // We accept a single JSON-RPC request here. (MCP also allows batches; defer.)
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return jsonRpcError(req?.id ?? null, -32600, "invalid request");
  }

  const id = req.id ?? null;
  switch (req.method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
      // JSON-RPC notifications have no id and expect no response.
      return new Response(null, { status: 204 });

    case "tools/list":
      return jsonRpcResult(id, { tools: listToolsForResponse() });

    case "tools/call": {
      const name = req.params?.name;
      const args = req.params?.arguments ?? {};
      const tool = findTool(name);
      if (!tool) {
        return jsonRpcError(id, -32602, `unknown tool: ${name}`);
      }
      try {
        const result = await tool.call(args, env);
        return jsonRpcResult(id, result);
      } catch (e) {
        return jsonRpcError(id, -32603, `tool execution failed: ${e?.message ?? e}`);
      }
    }

    case "ping":
      return jsonRpcResult(id, {});

    default:
      return jsonRpcError(id, -32601, `method not found: ${req.method}`);
  }
}

// ---- JSON-RPC helpers ----

function jsonRpcResult(id, result) {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id, code, message) {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
