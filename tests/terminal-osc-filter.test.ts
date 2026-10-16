import {describe, expect, it} from "vite-plus/test";
import {createOscFilter} from "../src/lib/terminal-osc-filter";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function run(chunks: readonly string[]): string {
	const filter = createOscFilter();
	return chunks.map((chunk) => decoder.decode(filter(encoder.encode(chunk)))).join("");
}

function everySplit(input: string): string[] {
	const outputs: string[] = [];
	for (let index = 0; index <= input.length; index++) {
		outputs.push(run([input.slice(0, index), input.slice(index)]));
	}
	return outputs;
}

describe("createOscFilter", () => {
	it("drops the iTerm2 shell-integration and tab-colour sequences zsh emits", () => {
		const input =
			"\u001B]1337;RemoteHost=craig@host.local\u0007" +
			"\u001B]1337;CurrentDir=/Users/craig/projects/klass\u0007" +
			"\u001B]1337;ShellIntegrationVersion=14;shell=zsh\u0007" +
			"\u001B]6;1;bg;red;brightness;35\u0007" +
			"\u001B]6;1;bg;green;brightness;35\u001B\\" +
			"\u001B]6;1;bg;blue;brightness;35\u0007" +
			"prompt% ";
		expect(run([input])).toBe("prompt% ");
	});

	it("drops them when split across chunks at any byte", () => {
		const input = "a\u001B]1337;CurrentDir=/tmp\u0007b\u001B]6;1;bg;red;brightness;35\u001B\\c";
		expect(new Set(everySplit(input))).toEqual(new Set(["abc"]));
	});

	it("passes title, hyperlink, cwd, and semantic-prompt sequences through untouched", () => {
		const input =
			"\u001B]0;title\u0007" +
			"\u001B]2;window\u001B\\" +
			"\u001B]8;;https://example.com\u0007link\u001B]8;;\u0007" +
			"\u001B]7;file://host/tmp\u0007" +
			"\u001B]133;A\u0007" +
			"\u001B]13370;x\u0007" +
			"\u001B]61;x\u0007";
		expect(new Set(everySplit(input))).toEqual(new Set([input]));
	});

	it("passes other escape sequences and plain bytes through", () => {
		const input = "\u001B[1;31mred\u001B[0m \u001B(B\u001B\u001B]xé";
		expect(new Set(everySplit(input))).toEqual(new Set([input]));
	});
});
