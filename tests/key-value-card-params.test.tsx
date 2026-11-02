// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {KeyValueCard} from "../src/components/tool-renderers/shared";

vi.mock("../src/hooks/use-shiki", () => (
{
	useHighlightedLines: () => null,
	getHighlighterSync: () => null,
	getHighlighterVersion: () => 0,
	subscribeHighlighter: () => () =>
	{
	},
}));

function paramsContainer(container: HTMLElement): HTMLElement
{
	const found = container.querySelector<HTMLElement>('[class*="gap-g2"]');
	if (!found) throw new Error("Missing params container");
	return found;
}

afterEach(cleanup);

describe("KeyValueCard params", () =>
{
	it("stacks each param as upstream's break-words row: a 12/17 mono key, a space, then the value as plain body text", () =>
	{
		const {container} = render(
			<KeyValueCard
				params={[
					{
						key: "query",
						value: "ROXON tool",
					},
					{
						key: "path",
						value: "src",
					},
				]}
			/>,
		);
		const params = paramsContainer(container);

		expect(
			{
				containerClass: params.className,
				rows: [...params.children].map((row) => (
				{
					className: row.className,
					key: row.firstElementChild?.className,
					nodes: [...row.childNodes].map((node) => node.textContent),
				})),
			},
		).toStrictEqual(
			{
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
			},
		);
	});

	it("draws a file_path or notebook_path value as upstream's Zv does: u9(ME(path)) in a cds-inline-code chip; other values as its plain renderer, each secret cloaked", () =>
	{
		const rlo = String.fromCodePoint(0x202e);
		const token = `ghp_${"A".repeat(36)}`;
		const {container} = render(
			<KeyValueCard
				params={[
					{
						key: "file_path",
						value: `/x/${rlo}gpj.exe`,
					},
					{
						key: "notebook_path",
						value: `/x/${token}/a.ipynb`,
					},
					{
						key: "note",
						value: `${rlo}raw ${token}`,
					},
				]}
			/>,
		);

		expect(
			[...paramsContainer(container).children].map((row) =>
			{
				const value = row.lastElementChild;
				return {
					className: value?.className,
					inner: [...(value?.children ?? [])].map((child) => child.tagName),
					cloaks: value?.querySelectorAll("[data-redacted-secret]").length,
					text: value?.textContent,
				};
			}),
		).toStrictEqual([
			{
				className: "min-w-0 break-words",
				inner: ["CODE"],
				cloaks: 0,
				text: "/x/[U+202E]gpj.exe",
			},
			{
				className: "min-w-0 break-words",
				inner: ["CODE"],
				cloaks: 0,
				text: `/x/ghp_AAAA${"•".repeat(32)}/a.ipynb`,
			},
			{
				className: "min-w-0 break-words",
				inner: ["SPAN"],
				cloaks: 1,
				text: `${rlo}raw Redacted GitHub tokenghp_AAAA${"•".repeat(32)}`,
			},
		]);
	});

	it("shows a plain value's controls as upstream's c62da1b56 R does, masking in place only beside a control, and links its URLs", () =>
	{
		const token = `ghp_${"A".repeat(36)}`;
		const {container} = render(
			<KeyValueCard
				params={[
					{
						key: "colored",
						value: `\u001b[31m${token}\u001b[0m`,
					},
					{
						key: "bell",
						value: "ding\u0007",
					},
					{
						key: "url",
						value: "see https://example.com/docs now",
					},
				]}
			/>,
		);

		expect(
			[...paramsContainer(container).children].map((row) =>
			{
				const value = row.lastElementChild;
				return {
					cloaks: value?.querySelectorAll("[data-redacted-secret]").length,
					links: [...(value?.querySelectorAll("a") ?? [])].map((link) => link.getAttribute("href")),
					text: value?.textContent,
				};
			}),
		).toStrictEqual([
			{
				cloaks: 0,
				links: [],
				text: `ghp_AAAA${"•".repeat(32)}\n[U+001B][31m\n[U+001B][0m`,
			},
			{
				cloaks: 0,
				links: [],
				text: "ding[U+0007]",
			},
			{
				cloaks: 0,
				links: ["https://example.com/docs"],
				text: "see https://example.com/docs(opens in new tab) now",
			},
		]);
	});

	it("marks a path chip left-to-right on a right-to-left page, as upstream's Zv does", () =>
	{
		document.documentElement.dir = "rtl";
		try
		{
			const {container} = render(
				<KeyValueCard
					params={[
						{
							key: "file_path",
							value: "/x/a.ts",
						},
					]}
				/>,
			);
			expect(paramsContainer(container).querySelector("code")?.getAttribute("dir")).toBe("ltr");
		}
		finally
		{
			document.documentElement.dir = "";
		}
	});
});
