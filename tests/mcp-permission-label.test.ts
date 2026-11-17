import {describe, expect, it} from "vite-plus/test";

import {mcpPermissionLabel} from "../src/lib/mcp-permission-label";

describe("mcpPermissionLabel, as upstream's mcp__ copy fallback", () =>
{
	it.each([
		{
			name: "mcp__github__create_issue",
			expected:
			{
				label: "create issue (github)",
				origin: "github",
			},
		},
		{
			name: "mcp__claude-in-chrome__navigate",
			expected:
			{
				label: "navigate (claude-in-chrome)",
				origin: "claude-in-chrome",
			},
		},
		{
			name: "mcp__plugin_playwright_playwright__browser_navigate",
			expected:
			{
				label: "browser navigate (plugin playwright playwright)",
				origin: "plugin playwright playwright",
			},
		},
		{
			name: "mcp__claude_ai_Gmail__search_threads",
			expected:
			{
				label: "search threads (claude ai Gmail)",
				origin: "claude ai Gmail",
			},
		},
		{
			name: "mcp__a__b__c",
			expected:
			{
				label: "c (a b)",
				origin: "a b",
			},
		},
		{
			name: "mcp__srv___tool",
			expected:
			{
				label: "tool (srv)",
				origin: "srv",
			},
		},
		{
			name: "mcp__srv__do_",
			expected:
			{
				label: "do (srv)",
				origin: "srv",
			},
		},
		{
			name: "mcp__imcp",
			expected:
			{
				label: "imcp",
			},
		},
		{
			name: "mcp____x",
			expected:
			{
				label: "x",
			},
		},
		{
			name: "mcp__​__t",
			expected:
			{
				label: "t (unknown server)",
				origin: "unknown server",
			},
		},
		{
			name: "Bash",
			expected: null,
		},
	])("labels $name", ({name, expected}) =>
	{
		expect(mcpPermissionLabel(name)).toStrictEqual(expected);
	});
});
