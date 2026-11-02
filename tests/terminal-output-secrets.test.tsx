// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {BashRenderer} from "../src/components/tool-renderers/bash-renderer";
import {ReadRenderer} from "../src/components/tool-renderers/read-renderer";
import {AnsiText, TerminalOutput} from "../src/components/tool-renderers/shared";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

const useHighlightedLines = vi.hoisted(() => vi.fn<(code: string, language: string | null) => null>(() => null));
vi.mock("../src/hooks/use-shiki", () => (
{
	useHighlightedLines,
}));

afterEach(cleanup);

const FAKE_GH = `ghp_${"A".repeat(36)}`;
const MASKED_GH = `ghp_AAAA${"•".repeat(32)}`;
const FAKE_AWS = "AKIAEXAMPLEFAKE12345";
const MASKED_AWS = `AKIAEXAM${"•".repeat(12)}`;

function toggleState(container: HTMLElement)
{
	const button = container.querySelector("button[data-reveal-secrets]");
	return button === null
		? null
		:
			{
				label: button.getAttribute("aria-label"),
				pressed: button.getAttribute("aria-pressed"),
			};
}

describe("TerminalOutput secrets", () =>
{
	it("masks a token and reveals it with the toggle", () =>
	{
		const {container} = render(<TerminalOutput content={`Exit code 0\nexport GH=${FAKE_GH}`} />);
		const masked =
		{
			text: container.querySelector("pre")!.textContent,
			toggle: toggleState(container),
		};
		fireEvent.click(container.querySelector("button[data-reveal-secrets]")!);
		const revealed =
		{
			text: container.querySelector("pre")!.textContent,
			toggle: toggleState(container),
		};
		expect(
			{
				masked,
				revealed,
			},
		).toStrictEqual(
			{
				masked:
				{
					text: `export GH=${MASKED_GH}`,
					toggle:
					{
						label: "Reveal 1 secret",
						pressed: "false",
					},
				},
				revealed:
				{
					text: `export GH=${FAKE_GH}`,
					toggle:
					{
						label: "Hide 1 secret",
						pressed: "true",
					},
				},
			},
		);
	});

	it("has no toggle without secrets", () =>
	{
		const {container} = render(<TerminalOutput content="all fine" />);
		expect(toggleState(container)).toBe(null);
	});
});

describe("AnsiText secrets", () =>
{
	it("keeps ANSI styling while masking across parts", () =>
	{
		const {container} = render(<AnsiText content={`\x1b[31mkey ghp_AAAA\x1b[0m${"A".repeat(32)} ok`} masked />);
		expect(
			[...container.querySelectorAll("span")].map((span) => (
			{
				text: span.textContent,
				color: span.style.color,
			})),
		).toStrictEqual([
			{
				text: "key ghp_AAAA",
				color: "rgb(204, 0, 0)",
			},
			{
				text: `${"•".repeat(32)} ok`,
				color: "",
			},
		]);
	});
});

describe("BashRenderer secrets", () =>
{
	const call: ClientToolCall =
	{
		id: "tool-bash-secret",
		name: "Bash",
		input:
		{
			command: `echo ${FAKE_AWS}`,
		},
		param: `echo ${FAKE_AWS}`,
		result: `$ echo ${FAKE_AWS}\n${FAKE_AWS}\ntoken=${FAKE_GH}`,
		sourceUuid: "uuid-secret",
	};

	it("masks command and output, with a Reveal toggle before Copy in the card rail", () =>
	{
		const writeText = vi.fn<Clipboard["writeText"]>(async () => Promise.resolve());
		Object.defineProperty(
			navigator,
			"clipboard",
			{
				value:
				{
					writeText,
				},
				configurable: true,
			},
		);
		const {container} = render(<BashRenderer toolCall={call} />);
		const card = container.querySelector("[data-bash-code-card]")!;
		const state = () => (
		{
			command: card.querySelector(".select-none")!.parentElement!.textContent,
			output: container.querySelector("[data-bash-output]")!.textContent,
			railButtons: [...card.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
		});
		const masked = state();
		fireEvent.click(card.querySelector("button[aria-label='Copy']")!);
		fireEvent.click(card.querySelector("button[data-reveal-secrets]")!);
		const revealed = state();
		fireEvent.click(card.querySelector("button[aria-label='Copy']")!);
		expect(
			{
				masked,
				revealed,
				copies: writeText.mock.calls,
			},
		).toStrictEqual(
			{
				masked:
				{
					command: `$ echo ${MASKED_AWS}`,
					output: `${MASKED_AWS}\ntoken=${MASKED_GH}`,
					railButtons: ["Reveal 3 secrets", "Copy"],
				},
				revealed:
				{
					command: `$ echo ${FAKE_AWS}`,
					output: `${FAKE_AWS}\ntoken=${FAKE_GH}`,
					railButtons: ["Hide 3 secrets", "Copy"],
				},
				copies: [
					[`echo ${MASKED_AWS}\n${MASKED_AWS}\ntoken=${MASKED_GH}`],
					[`echo ${FAKE_AWS}\n${FAKE_AWS}\ntoken=${FAKE_GH}`],
				],
			},
		);
	});
});

describe("ReadRenderer secrets", () =>
{
	it("highlights and shows masked file content with a header toggle", () =>
	{
		useHighlightedLines.mockClear();
		const call: ClientToolCall =
		{
			id: "tool-read-secret",
			name: "Read",
			input:
			{
				file_path: "/test/env.sh",
			},
			param: "/test/env.sh",
			result: `1→export KEY=${FAKE_AWS}`,
			sourceUuid: "source-read-secret",
		};
		const {container} = render(<ReadRenderer toolCall={call} />);
		const masked =
		{
			content: container.querySelector("[data-content]")!.textContent,
			highlighted: useHighlightedLines.mock.calls.at(-1)?.[0],
			toggle: toggleState(container),
		};
		fireEvent.click(container.querySelector("button[data-reveal-secrets]")!);
		expect(
			{
				masked,
				revealed:
				{
					content: container.querySelector("[data-content]")!.textContent,
					highlighted: useHighlightedLines.mock.calls.at(-1)?.[0],
					toggle: toggleState(container),
				},
			},
		).toStrictEqual(
			{
				masked:
				{
					content: `export KEY=${MASKED_AWS}`,
					highlighted: `export KEY=${MASKED_AWS}`,
					toggle:
					{
						label: "Reveal 1 secret",
						pressed: "false",
					},
				},
				revealed:
				{
					content: `export KEY=${FAKE_AWS}`,
					highlighted: `export KEY=${FAKE_AWS}`,
					toggle:
					{
						label: "Hide 1 secret",
						pressed: "true",
					},
				},
			},
		);
	});
});
