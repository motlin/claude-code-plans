import {describe, expect, it} from "vite-plus/test";
import {claudeDark} from "../src/lib/claude-dark-theme";
import {claudeLight} from "../src/lib/claude-light-theme";
import {selectionMatchColor} from "../src/lib/code-theme-vars";
import vscodeDark from "../src/lib/vscode-dark-theme.json";
import vscodeLight from "../src/lib/vscode-light-theme.json";

describe("selectionMatchColor", () =>
{
	it("picks upstream c5d464fa3 B's selection-match colour per theme", () =>
	{
		expect(
			{
				claudeDark: selectionMatchColor(claudeDark.colors ?? {}, "dark"),
				claudeLight: selectionMatchColor(claudeLight.colors ?? {}, "light"),
				vscodeLight: selectionMatchColor(vscodeLight.colors, "light"),
				vscodeDark: selectionMatchColor(vscodeDark.colors, "dark"),
				sameAsSelection: selectionMatchColor(
					{
						"editor.selectionHighlightBackground": "#111",
						"editor.selectionBackground": "#111",
						"editor.findMatchHighlightBackground": "#222",
					},
					"dark",
				),
				lightDefault: selectionMatchColor({}, "light"),
				darkDefault: selectionMatchColor({}, "dark"),
			},
		).toStrictEqual(
			{
				claudeDark: "#0099ff24",
				claudeLight: "#0073e61a",
				vscodeLight: "#0069CC15",
				vscodeDark: "#27678240",
				sameAsSelection: "#222",
				lightDefault: "#0073e61a",
				darkDefault: "#0099ff24",
			},
		);
	});
});
