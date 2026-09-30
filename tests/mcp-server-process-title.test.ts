import {afterEach, describe, expect, it} from "vite-plus/test";
import {MCP_PROCESS_TITLE, setMcpProcessTitle} from "../mcp-server/index";

const originalTitle = process.title;

afterEach(() => {
	process.title = originalTitle;
});

describe("MCP server process title", () => {
	it("names the process so it is identifiable in ps", () => {
		setMcpProcessTitle();

		expect({constant: MCP_PROCESS_TITLE, title: process.title}).toStrictEqual({
			constant: "claude-code-browser-mcp",
			title: "claude-code-browser-mcp",
		});
	});
});
