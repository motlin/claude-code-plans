// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {KeyValueCard} from "../src/components/tool-renderers/shared";

vi.mock("../src/hooks/use-shiki", () => ({
	useHighlightedLines: () => null,
	getHighlighterSync: () => null,
	getHighlighterVersion: () => 0,
	subscribeHighlighter: () => () => {},
}));

function paramsContainer(container: HTMLElement): HTMLElement {
	const found = container.querySelector<HTMLElement>('[class*="gap-g2"]');
	if (!found) throw new Error("Missing params container");
	return found;
}

afterEach(cleanup);

describe("KeyValueCard params", () => {
	it("stacks each param as upstream's break-words row: a 12/17 mono key, a space, then the value as plain body text", () => {
		const {container} = render(
			<KeyValueCard
				params={[
					{key: "query", value: "ROXON tool"},
					{key: "path", value: "src"},
				]}
			/>,
		);
		const params = paramsContainer(container);

		expect({
			containerClass: params.className,
			rows: [...params.children].map((row) => ({
				className: row.className,
				key: row.firstElementChild?.className,
				nodes: [...row.childNodes].map((node) => node.textContent),
			})),
		}).toStrictEqual({
			containerClass: "text-secondary flex flex-col gap-g2",
			rows: [
				{
					className: "break-words",
					key: "text-[12px]/[17px] font-mono opacity-70",
					nodes: ["query:", " ", "ROXON tool"],
				},
				{
					className: "break-words",
					key: "text-[12px]/[17px] font-mono opacity-70",
					nodes: ["path:", " ", "src"],
				},
			],
		});
	});
});
