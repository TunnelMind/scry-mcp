// Scry MCP tool definitions.
//
// Each tool has:
//   - name:        snake_case identifier the agent calls
//   - description: 7-section LLM template (when/when-not, inputs, outputs, cost, latency)
//   - inputSchema: JSON Schema for arguments
//   - call(args, env) → { content: [...] }   — invokes the upstream API and shapes the result

export const TOOLS = [
  {
    name: "scry_stats",
    description:
      "Returns aggregate Scry corpus telemetry: total observation count, distinct\n" +
      "source IPs, first/last observation timestamps, last-24h activity, and\n" +
      "per-protocol breakdowns. Useful as a liveness/density check before issuing\n" +
      "per-IP queries — lets an agent decide whether the corpus has enough data\n" +
      "to be authoritative.\n" +
      "\n" +
      "Use this tool when:\n" +
      "- An agent is planning a multi-step investigation and wants to know if Scry\n" +
      "  has corpus density worth querying.\n" +
      "- You want to expose a 'corpus health' signal in a dashboard or report.\n" +
      "- You're deciding whether to weight Scry findings vs. another data source.\n" +
      "\n" +
      "Do NOT use this tool when:\n" +
      "- You want details about a specific IP — use `scry_check` instead.\n" +
      "- You want sensor fleet size or node identities — those are not exposed at any tier.\n" +
      "\n" +
      "Inputs:\n" +
      "- None.\n" +
      "\n" +
      "Returns:\n" +
      "- total_observations, distinct_source_ips, first_seen_ms, last_seen_ms,\n" +
      "  observations_last_24h, distinct_source_ips_last_24h, by_protocol (object),\n" +
      "  as_of_ms.\n" +
      "\n" +
      "Cost:\n" +
      "- Free, anonymous. Rate-limited per caller.\n" +
      "\n" +
      "Latency:\n" +
      "- Typical <100ms (3 parallel D1 aggregate queries).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async call(_args, env) {
      const resp = await env.API.fetch(
        new Request("https://api.tunnelmind.ai/v1/stats", {
          headers: { Accept: "application/json" },
        })
      );
      const text = await resp.text();
      if (!resp.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Upstream API returned ${resp.status}: ${text}` }],
        };
      }
      return { content: [{ type: "text", text }] };
    },
  },
  {
    name: "scry_check",
    description:
      "Returns Scry's corpus knowledge for a single IPv4 address: when it was first/last\n" +
      "observed by Familiar sensor nodes, how many observations exist, which protocols\n" +
      "and ports it has been seen targeting, and its ASN/country.\n" +
      "\n" +
      "Use this tool when:\n" +
      "- An agent needs to assess whether an IP is known-hostile before allowing traffic.\n" +
      "- You're investigating a suspicious connection and want corpus context.\n" +
      "- Building a quick risk signal for an IP from anonymous, free data.\n" +
      "\n" +
      "Do NOT use this tool when:\n" +
      "- You need actor profiles, campaign groupings, or tradecraft fingerprints — those\n" +
      "  are defender-tier (require ATAP attestation) and not yet exposed via MCP.\n" +
      "- You need raw payload bytes — Scry never exposes attacker payloads.\n" +
      "- You need IPv6 lookup — not yet supported (corpus is v4-only at v0.1).\n" +
      "\n" +
      "Inputs:\n" +
      "- ip (required): IPv4 address. Reserved/non-routable addresses (RFC 1918, link-local,\n" +
      "  loopback, multicast) are short-circuited to 'not_observed' without a corpus query.\n" +
      "\n" +
      "Returns (always the same shape):\n" +
      "- ip, status ('observed' | 'not_observed'), first_seen_ms, last_seen_ms,\n" +
      "  observation_count, protocols (array), ports (array), asn, country, as_of_ms.\n" +
      "\n" +
      "Cost:\n" +
      "- Free, anonymous. Rate-limited per caller IP (60 req/min base, 10x burst).\n" +
      "\n" +
      "Latency:\n" +
      "- Typical <50ms (single-region D1 query).",
    inputSchema: {
      type: "object",
      properties: {
        ip: {
          type: "string",
          description: "IPv4 address to look up (e.g. '8.8.8.8')",
        },
      },
      required: ["ip"],
      additionalProperties: false,
    },
    async call(args, env) {
      const ip = String(args?.ip ?? "");
      // Service binding — direct runtime call into scry-api Worker.
      // Hostname is irrelevant here; the path is what scry-api routes on.
      const resp = await env.API.fetch(
        new Request(`https://api.tunnelmind.ai/v1/check/${encodeURIComponent(ip)}`, {
          headers: { Accept: "application/json" },
        })
      );
      const text = await resp.text();
      if (!resp.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Upstream API returned ${resp.status}: ${text}`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text }],
      };
    },
  },
];

export function findTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

export function listToolsForResponse() {
  return TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}
