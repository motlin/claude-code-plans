// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {LinedScript} from "../src/components/lined-script";

afterEach(() =>
{
	cleanup();
});

const LINE_CLASS =
	"relative block ps-[6ch] before:absolute before:start-0 before:w-[4.5ch] before:text-end before:text-muted-as-secondary before:select-none before:content-[attr(data-line)]";

function draw(script: string)
{
	const {container} = render(<LinedScript script={script} />);
	const pre = container.querySelector("pre")!;
	return {
		dir: pre.getAttribute("dir"),
		className: pre.getAttribute("class"),
		lines: [...pre.children].map((line) => (
		{
			line: line.getAttribute("data-line"),
			className: line.getAttribute("class"),
			text: line.textContent,
		})),
		text: pre.textContent,
	};
}

describe("LinedScript, as upstream's Jb (was Cb)", () =>
{
	it("numbers each line and keeps the script's closing newline", () =>
	{
		expect(draw("a\nb\n")).toStrictEqual(
			{
				dir: "ltr",
				className:
					"py-md pe-lg text-code text-secondary whitespace-break-spaces break-words select-text [unicode-bidi:bidi-override]",
				lines: [
					{
						line: "1",
						className: LINE_CLASS,
						text: "a\n",
					},
					{
						line: "2",
						className: LINE_CLASS,
						text: "b\n",
					},
				],
				text: "a\nb\n",
			},
		);
	});

	it("ends the last line bare when the script has no closing newline", () =>
	{
		expect(draw("a\nb").lines.map((line) => line.text)).toStrictEqual(["a\n", "b"]);
	});

	it("draws an empty script as one empty line", () =>
	{
		expect(
			draw("").lines.map(({line, text}) => (
			{
				line,
				text,
			})),
		).toStrictEqual([
			{
				line: "1",
				text: "",
			},
		]);
	});
});
