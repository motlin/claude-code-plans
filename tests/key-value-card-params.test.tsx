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

	it("draws a file_path or notebook_path value as upstream's Zv does: u9(ME(path)) in a cds-inline-code chip; other values masked with display controls stripped", () => {
		const rlo = String.fromCodePoint(0x202e);
		const token = `ghp_${"A".repeat(36)}`;
		const {container} = render(
			<KeyValueCard
				params={[
					{key: "file_path", value: `/x/${rlo}gpj.exe`},
					{key: "notebook_path", value: `/x/${token}/a.ipynb`},
					{key: "note", value: `${rlo}raw ${token}`},
				]}
			/>,
		);

		expect(
			[...paramsContainer(container).children].map((row) => {
				const value = row.lastChild;
				return value instanceof HTMLElement
					? {
							className: value.className,
							inner: [...value.children].map((child) => `${child.tagName}.${child.className}`),
							text: value.textContent,
						}
					: {text: value?.textContent};
			}),
		).toStrictEqual([
			{className: "min-w-0 break-words", inner: ["CODE.cds-inline-code"], text: "/x/[U+202E]gpj.exe"},
			{
				className: "min-w-0 break-words",
				inner: ["CODE.cds-inline-code"],
				text: `/x/ghp_AAAA${"•".repeat(32)}/a.ipynb`,
			},
			{text: `raw ghp_AAAA${"•".repeat(32)}`},
		]);
	});
});
