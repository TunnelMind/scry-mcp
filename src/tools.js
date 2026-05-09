// Scry MCP tool definitions.
//
// Each tool has:
//   - name:        snake_case identifier the agent calls
//   - description: 7-section LLM template (when/when-not, inputs, outputs, cost, latency)
//   - inputSchema: JSON Schema for arguments
//   - call(args, env) → { content: [...] }   — invokes the upstream API and shapes the result

// Helper: GET via Service Binding to scry-api (no DNS, no proxy hop).
async function apiGet(env, path) {
  const resp = await env.API.fetch(
    new Request(`https://api.tunnelmind.ai${path}`, {
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
}

async function apiPost(env, path, body) {
  const resp = await env.API.fetch(
    new Request(`https://api.tunnelmind.ai${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
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
}

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
      return apiGet(env, `/v1/check/${encodeURIComponent(ip)}`);
    },
  },
  {
    name: "scry_check_bulk",
    description:
      "Look up many IPv4 addresses in one request. Up to 100 IPs per call.\n" +
      "Returns the same per-IP shape as scry_check, keyed by IP.\n" +
      "\n" +
      "Use this tool when:\n" +
      "- You're triaging a list of IPs from a log and want them all at once.\n" +
      "- You're enriching a SIEM alert with multiple source IPs.\n" +
      "\n" +
      "Do NOT use this tool when:\n" +
      "- You only have one IP — use scry_check instead.\n" +
      "- You have more than 100 IPs — split into chunks.\n" +
      "\n" +
      "Inputs:\n" +
      "- ips (required): array of IPv4 strings, 1–100.\n" +
      "\n" +
      "Returns:\n" +
      "- results: object keyed by IP. Each entry has the same shape as scry_check.\n" +
      "- Invalid IPs return { status: 'invalid', error: ... } and don't count against the rate limit.\n" +
      "\n" +
      "Cost: free, anonymous. Counts as one call against the rate limit regardless of batch size.\n" +
      "Latency: typical <300ms for 100 IPs.",
    inputSchema: {
      type: "object",
      properties: {
        ips: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 100,
        },
      },
      required: ["ips"],
      additionalProperties: false,
    },
    async call(args, env) {
      return apiPost(env, "/v1/check/bulk", { ips: args?.ips ?? [] });
    },
  },
  {
    name: "scry_top",
    description:
      "Top-N source dimensions over a time window. Useful for situational\n" +
      "awareness — 'where is the noise coming from right now?'\n" +
      "\n" +
      "Use this tool when:\n" +
      "- Building a daily/weekly threat-landscape briefing.\n" +
      "- An agent wants to know which ASNs/countries/protocols dominate recent traffic.\n" +
      "- Generating a defender dashboard.\n" +
      "\n" +
      "Do NOT use this tool when:\n" +
      "- You want details about one specific IP — use scry_check.\n" +
      "- You want a time-series trend — use scry_timeseries.\n" +
      "\n" +
      "Inputs:\n" +
      "- dimension (default 'asn'): one of asn, country, protocol, port.\n" +
      "- since (default last 24h): unix ms.\n" +
      "- limit (default 20, max 100).\n" +
      "- include_noise (default false): include known scanners (Shodan, Censys, etc.).\n" +
      "\n" +
      "Returns: array of { value, observations, distinct_source_ips }, sorted desc.",
    inputSchema: {
      type: "object",
      properties: {
        dimension: { type: "string", enum: ["asn", "country", "protocol", "port"] },
        since_ms: { type: "integer" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        include_noise: { type: "boolean" },
      },
      additionalProperties: false,
    },
    async call(args, env) {
      const params = new URLSearchParams();
      if (args?.dimension) params.set("dimension", String(args.dimension));
      if (args?.since_ms != null) params.set("since", String(args.since_ms));
      if (args?.limit != null) params.set("limit", String(args.limit));
      if (args?.include_noise) params.set("include_noise", "true");
      const qs = params.toString();
      return apiGet(env, `/v1/top${qs ? "?" + qs : ""}`);
    },
  },
  {
    name: "scry_timeseries",
    description:
      "Bucketed observation counts over a time range. Detect bursts, plot\n" +
      "trends, sanity-check whether attacker activity is rising or falling.\n" +
      "\n" +
      "Use this tool when:\n" +
      "- You want a count-over-time chart of corpus activity.\n" +
      "- You're checking 'is something happening right now?' (compare last hour to recent baseline).\n" +
      "\n" +
      "Do NOT use this tool when:\n" +
      "- You want totals, not per-bucket — use scry_stats.\n" +
      "- You want individual events — this is aggregated only.\n" +
      "\n" +
      "Inputs:\n" +
      "- bucket (default 'hour'): one of minute, hour, day.\n" +
      "- since_ms (default now-24h).\n" +
      "- until_ms (default now).\n" +
      "Constraints: max 30-day range, max 720 buckets per query.\n" +
      "\n" +
      "Returns: { bucket, since_ms, until_ms, buckets: [{ ts_ms, observations, distinct_source_ips }] }.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", enum: ["minute", "hour", "day"] },
        since_ms: { type: "integer" },
        until_ms: { type: "integer" },
      },
      additionalProperties: false,
    },
    async call(args, env) {
      const params = new URLSearchParams();
      if (args?.bucket) params.set("bucket", String(args.bucket));
      if (args?.since_ms != null) params.set("since", String(args.since_ms));
      if (args?.until_ms != null) params.set("until", String(args.until_ms));
      const qs = params.toString();
      return apiGet(env, `/v1/stats/timeseries${qs ? "?" + qs : ""}`);
    },
  },
  {
    name: "scry_asn",
    description:
      "Roll-up of corpus activity for a single ASN — observation count, distinct\n" +
      "source IPs, actor count, scanner count, high-confidence actor count, and\n" +
      "per-protocol breakdown.\n" +
      "\n" +
      "Use this tool when:\n" +
      "- An IP came from ASN X and you want context: how prolific is this ASN, is it mostly noise, etc.\n" +
      "- Reputation-scoring an ASN as part of a routing decision.\n" +
      "\n" +
      "Inputs:\n" +
      "- asn (required): ASN string. May contain spaces (Cymru multi-origin format).\n" +
      "- since_ms (default 0 = all-time).\n" +
      "\n" +
      "Returns: { asn, observation_count, distinct_source_ips, actor_count, scanner_count, high_confidence_actor_count, by_protocol, first_seen_ms, last_seen_ms }.",
    inputSchema: {
      type: "object",
      properties: {
        asn: { type: "string" },
        since_ms: { type: "integer" },
      },
      required: ["asn"],
      additionalProperties: false,
    },
    async call(args, env) {
      const asn = String(args?.asn ?? "");
      const params = new URLSearchParams();
      if (args?.since_ms != null) params.set("since", String(args.since_ms));
      const qs = params.toString();
      return apiGet(env, `/v1/asn/${encodeURIComponent(asn)}${qs ? "?" + qs : ""}`);
    },
  },
  {
    name: "scry_country",
    description:
      "Roll-up of corpus activity by ISO country code. Same shape as scry_asn.\n" +
      "Useful for geo-scoped threat reporting.\n" +
      "\n" +
      "Inputs:\n" +
      "- country (required): ISO-3166-1 alpha-2 (e.g. 'US', 'CN', 'NL').\n" +
      "- since_ms (default 0 = all-time).",
    inputSchema: {
      type: "object",
      properties: {
        country: { type: "string", pattern: "^[A-Za-z]{2}$" },
        since_ms: { type: "integer" },
      },
      required: ["country"],
      additionalProperties: false,
    },
    async call(args, env) {
      const cc = String(args?.country ?? "").toUpperCase();
      const params = new URLSearchParams();
      if (args?.since_ms != null) params.set("since", String(args.since_ms));
      const qs = params.toString();
      return apiGet(env, `/v1/country/${encodeURIComponent(cc)}${qs ? "?" + qs : ""}`);
    },
  },
  {
    name: "scry_recent",
    description:
      "Recent observations feed — aggregated by source IP within a time window.\n" +
      "Cursor-paginated via `since_ms` (use the response's `next_cursor_since_ms`\n" +
      "for the next page). Filter by protocol or country.\n" +
      "\n" +
      "Use this tool when:\n" +
      "- An agent is monitoring for new threats in real-time-ish.\n" +
      "- You're hunting for specific traffic patterns (e.g. recent SMB or RDP scans).\n" +
      "- Building a 'live activity' panel.\n" +
      "\n" +
      "Do NOT use this tool when:\n" +
      "- You want one specific IP — use scry_check.\n" +
      "- You want totals — use scry_stats or scry_timeseries.\n" +
      "\n" +
      "Inputs:\n" +
      "- since_ms (default now-1h, max 7d lookback).\n" +
      "- limit (default 50, max 500).\n" +
      "- protocol (optional filter).\n" +
      "- country (optional, ISO alpha-2).\n" +
      "- include_noise (default false).",
    inputSchema: {
      type: "object",
      properties: {
        since_ms: { type: "integer" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        protocol: { type: "string" },
        country: { type: "string", pattern: "^[A-Za-z]{2}$" },
        include_noise: { type: "boolean" },
      },
      additionalProperties: false,
    },
    async call(args, env) {
      const params = new URLSearchParams();
      if (args?.since_ms != null) params.set("since", String(args.since_ms));
      if (args?.limit != null) params.set("limit", String(args.limit));
      if (args?.protocol) params.set("protocol", String(args.protocol));
      if (args?.country) params.set("country", String(args.country).toUpperCase());
      if (args?.include_noise) params.set("include_noise", "true");
      const qs = params.toString();
      return apiGet(env, `/v1/recent${qs ? "?" + qs : ""}`);
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
