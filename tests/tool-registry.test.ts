import { describe, expect, it } from "vite-plus/test";
import { getToolRenderer } from "../src/components/tool-renderers/index";

describe("getToolRenderer", () => {
  it("returns the same renderer reference for repeated calls with the same tool name", () => {
    expect(getToolRenderer("Bash")).toBe(getToolRenderer("Bash"));
  });

  it("returns different renderers for different known tools", () => {
    expect(getToolRenderer("Bash")).not.toBe(getToolRenderer("Read"));
  });

  it("returns the fallback renderer for unknown tools", () => {
    expect(getToolRenderer("UnknownTool")).toBe(getToolRenderer("AnotherUnknownTool"));
  });

  it("routes unknown MCP servers to the generic MCP renderer (distinct from non-MCP fallback)", () => {
    const mcpUnknown = getToolRenderer("mcp__unknown_server__some_tool");
    const nonMcpUnknown = getToolRenderer("UnknownTool");
    expect(mcpUnknown).not.toBe(nonMcpUnknown);
    expect(mcpUnknown).toBe(getToolRenderer("mcp__another_unknown__other_tool"));
  });

  it("routes chrome-devtools MCP tools to the same chrome-devtools renderer", () => {
    const navigate = getToolRenderer("mcp__chrome-devtools__navigate_page");
    const screenshot = getToolRenderer("mcp__chrome-devtools__take_screenshot");
    const networkList = getToolRenderer("mcp__chrome-devtools__list_network_requests");
    expect(navigate).toBe(screenshot);
    expect(navigate).toBe(networkList);
  });

  it("routes plugin-prefixed chrome-devtools MCP tools to the chrome-devtools renderer", () => {
    const pluginNavigate = getToolRenderer(
      "mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page",
    );
    expect(pluginNavigate).toBe(getToolRenderer("mcp__chrome-devtools__navigate_page"));
    expect(pluginNavigate).not.toBe(getToolRenderer("mcp__unknown_server__some_tool"));
  });

  it("routes chrome-devtools MCP tools differently from generic unknown MCP tools", () => {
    expect(getToolRenderer("mcp__chrome-devtools__navigate_page")).not.toBe(
      getToolRenderer("mcp__unknown_server__some_tool"),
    );
  });
});
