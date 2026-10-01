// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {BashRenderer} from "../src/components/tool-renderers/bash-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

vi.mock("../src/hooks/use-shiki", () => ({
	useHighlightedLines: () => null,
}));

afterEach(cleanup);

const CALL: ClientToolCall = {
	id: "tool-bash-1",
	name: "Bash",
	input: {command: "git status"},
	param: "git status",
	result: "$ git status\nnothing to commit",
	sourceUuid: "uuid-1",
};

function layout(container: HTMLElement) {
	const card = container.querySelector("[data-bash-code-card]");
	const output = container.querySelector("[data-bash-output]");
	return {
		body: card?.parentElement?.className,
		card: card?.className,
		cardText: card?.querySelector(".select-none")?.parentElement?.textContent,
		copyInCard: card?.querySelector("button[aria-label='Copy']") !== null,
		output: output?.className,
		outputText: output?.textContent,
	};
}

describe("BashRenderer code card", () => {
	it("wraps the prompt and command in upstream's white 12/17 code card with the copy rail inside", () => {
		const {container} = render(<BashRenderer toolCall={CALL} />);

		expect({...layout(container), header: container.querySelector(".px-p6.py-p5")?.textContent}).toStrictEqual({
			header: "Bash",
			body: "flex flex-col gap-g6 px-p6 pb-p8 font-mono",
			card: "relative rounded-r6 bg-surface-1 py-p3 pl-p6 pr-[32px] text-[12px]/[17px]",
			cardText: "$ git status",
			copyInCard: true,
			output: "max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all text-[12px]/[17px] text-secondary",
			outputText: "nothing to commit",
		});
	});

	it("uses the same card inside a grouped row, keeping the copy button beside the body", () => {
		const {container} = render(<BashRenderer toolCall={CALL} nested />);

		expect(layout(container)).toStrictEqual({
			body: "flex-1 min-w-0 flex flex-col gap-g6 font-mono",
			card: "relative rounded-r6 bg-surface-1 py-p3 pl-p6 pr-p6 text-[12px]/[17px]",
			cardText: "$ git status",
			copyInCard: false,
			output: "max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all text-[12px]/[17px] text-secondary",
			outputText: "nothing to commit",
		});
	});
});
