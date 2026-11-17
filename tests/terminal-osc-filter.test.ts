import {describe, expect, it} from "vite-plus/test";
import {createOscFilter, createPromptMarkSplitter, type TerminalStreamItem} from "../src/lib/terminal-osc-filter";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function run(chunks: readonly string[]): string
{
	const filter = createOscFilter();
	return chunks.map((chunk) => decoder.decode(filter(encoder.encode(chunk)))).join("");
}

function everySplit(input: string): string[]
{
	const outputs: string[] = [];
	for (let index = 0; index <= input.length; index++)
	{
		outputs.push(run([input.slice(0, index), input.slice(index)]));
	}
	return outputs;
}

describe("createOscFilter", () =>
{
	it("drops the iTerm2 shell-integration and tab-colour sequences zsh emits", () =>
	{
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

	it("drops them when split across chunks at any byte", () =>
	{
		const input = "a\u001B]1337;CurrentDir=/tmp\u0007b\u001B]6;1;bg;red;brightness;35\u001B\\c";
		expect(new Set(everySplit(input))).toEqual(new Set(["abc"]));
	});

	it("passes title, hyperlink, cwd, and semantic-prompt sequences through untouched", () =>
	{
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

	it("passes other escape sequences and plain bytes through", () =>
	{
		const input = "\u001B[1;31mred\u001B[0m \u001B(B\u001B\u001B]xé";
		expect(new Set(everySplit(input))).toEqual(new Set([input]));
	});
});

type Readable =
	|
	  {
			bytes: string;
	  }
	| Exclude<
			TerminalStreamItem,
			{
				bytes: Uint8Array;
			}
	  >;

function split(chunks: readonly string[]): Readable[]
{
	const filter = createOscFilter();
	const splitter = createPromptMarkSplitter();
	const items: Readable[] = [];
	for (const chunk of chunks)
	{
		for (const item of splitter(filter(encoder.encode(chunk))))
		{
			if (!("bytes" in item))
			{
				items.push(item);
				continue;
			}
			const text = decoder.decode(item.bytes);
			const last = items.at(-1);
			if (last !== undefined && "bytes" in last) last.bytes += text;
			else if (text !== "")
				items.push(
					{
						bytes: text,
					},
				);
		}
	}
	return items;
}

describe("createPromptMarkSplitter", () =>
{
	const session = "a\u001B]133;A\u0007$ \u001B]133;B\u0007ls\r\n\u001B]133;C;\u0007out\r\n\u001B]133;D;1\u0007";
	const expected: Readable[] = [
		{
			bytes: "a\u001B]133;A\u0007",
		},
		{
			mark: "A",
			arg: undefined,
		},
		{
			bytes: "$ \u001B]133;B\u0007",
		},
		{
			mark: "B",
			arg: undefined,
		},
		{
			bytes: "ls\r\n\u001B]133;C;\u0007",
		},
		{
			mark: "C",
			arg: "",
		},
		{
			bytes: "out\r\n\u001B]133;D;1\u0007",
		},
		{
			mark: "D",
			arg: "1",
		},
	];

	it("passes every byte through and emits each OSC 133 mark right after its terminator", () =>
	{
		expect(split([session])).toStrictEqual(expected);
	});

	it("emits the same bytes and marks when split at any byte", () =>
	{
		for (let index = 0; index <= session.length; index++)
		{
			expect(split([session.slice(0, index), session.slice(index)])).toStrictEqual(expected);
		}
	});

	it('keeps only the field after the mark, like upstream\'s split(";", 2)', () =>
	{
		expect(split(["\u001B]133;P;k=i\u001B\\", "\u001B]133;D;0;aid=7\u0007"])).toStrictEqual([
			{
				bytes: "\u001B]133;P;k=i\u001B\\",
			},
			{
				mark: "P",
				arg: "k=i",
			},
			{
				bytes: "\u001B]133;D;0;aid=7\u0007",
			},
			{
				mark: "D",
				arg: "0",
			},
		]);
	});

	it("emits a full reset after ESC c, also one that cuts an OSC string short, but not after CSI c", () =>
	{
		expect(split(["x\u001Bcy\u001B[c\u001B]0;a\u001Bc"])).toStrictEqual([
			{
				bytes: "x\u001Bc",
			},
			{
				fullReset: true,
			},
			{
				bytes: "y\u001B[c\u001B]0;a\u001Bc",
			},
			{
				fullReset: true,
			},
		]);
	});

	it("ignores other OSC commands and still drops OSC 1337 upstream of it", () =>
	{
		expect(split(["\u001B]1337;CurrentDir=/tmp\u0007\u001B]1330;A\u0007\u001B]13;A\u0007p"])).toStrictEqual([
			{
				bytes: "\u001B]1330;A\u0007\u001B]13;A\u0007p",
			},
		]);
	});
});
