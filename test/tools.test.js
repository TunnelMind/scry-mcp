// Unit tests for tool definitions. Worker integration tests are run as live
// smoke tests against the deployed mcp.tunnelmind.ai endpoint after deploy.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { TOOLS, findTool, listToolsForResponse } from "../src/tools.js";

test("tools list is non-empty and well-formed", () => {
  assert.ok(TOOLS.length >= 1, "should have at least one tool");
  for (const t of TOOLS) {
    assert.equal(typeof t.name, "string", "name");
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, `name format ${t.name}`);
    assert.equal(typeof t.description, "string", "description");
    assert.ok(t.description.length > 100, "description should be detailed");
    assert.equal(typeof t.inputSchema, "object", "inputSchema");
    assert.equal(t.inputSchema.type, "object", "inputSchema.type");
    assert.equal(typeof t.call, "function", "call");
  }
});

test("findTool returns the right tool or null", () => {
  assert.equal(findTool("scry_check")?.name, "scry_check");
  assert.equal(findTool("nope_doesnt_exist"), null);
  assert.equal(findTool(""), null);
  assert.equal(findTool(undefined), null);
});

test("listToolsForResponse strips internal call() field", () => {
  const list = listToolsForResponse();
  for (const t of list) {
    assert.equal(t.call, undefined, "call() must not be in MCP response");
    assert.ok(t.name && t.description && t.inputSchema);
  }
});

test("scry_check input schema requires ip", () => {
  const t = findTool("scry_check");
  assert.deepEqual(t.inputSchema.required, ["ip"]);
  assert.equal(t.inputSchema.properties.ip.type, "string");
  assert.equal(t.inputSchema.additionalProperties, false);
});
