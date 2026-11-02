// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {actAndSettle} from "./act-and-settle";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {PermissionCard} from "../src/components/permission-card";
import {PermissionRowsList} from "../src/components/permission-rows";

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

const LEAF_CLASS = "grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-baseline gap-x-3 @max-[420px]:grid-cols-1";
const LABEL_CLASS = "min-w-0 text-footnote select-text break-words text-muted-as-secondary";
const VALUE_CLASS = "min-w-0 select-text whitespace-pre-wrap break-words text-body text-primary";

describe("PermissionRowsList", () =>
{
	it("draws each leaf as upstream's label/value grid row", () =>
	{
		const {container} = render(
			<PermissionRowsList
				rows={[
					{
						label: "Path",
						value: "src\nlib",
					},
					{
						label: "-i",
						labelCode: true,
						value: "true",
						code: true,
					},
				]}
			/>,
		);
		const list = container.querySelector("ul")!;
		expect(
			{
				role: list.getAttribute("role"),
				label: list.getAttribute("aria-label"),
				className: list.className,
				items: [...list.children].map((item) => (
				{
					className: item.className,
					label: [
						item.children[0].className,
						item.children[0].getAttribute("dir"),
						item.children[0].textContent,
					],
					value: [
						item.children[1].className,
						item.children[1].getAttribute("dir"),
						item.children[1].hasAttribute("data-approval-value"),
						item.children[1].innerHTML,
					],
				})),
			},
		).toStrictEqual(
			{
				role: "list",
				label: "What Claude sent",
				className: "flex flex-col gap-0.75 @max-[420px]:gap-2",
				items: [
					{
						className: LEAF_CLASS,
						label: [`${LABEL_CLASS} [unicode-bidi:plaintext]`, null, "Path"],
						value: [VALUE_CLASS, null, true, "<bdi>src</bdi>\n<bdi>lib</bdi>"],
					},
					{
						className: LEAF_CLASS,
						label: [
							`${LABEL_CLASS} font-mono whitespace-pre-wrap [unicode-bidi:bidi-override]`,
							"ltr",
							"-i",
						],
						value: [`${VALUE_CLASS} font-mono [unicode-bidi:bidi-override] text-code`, "ltr", true, "true"],
					},
				],
			},
		);
	});

	it("draws a group as an open Collapsible with a nested bordered list", () =>
	{
		const {container} = render(
			<PermissionRowsList
				rows={[
					{
						label: "Opts",
						rows: [
							{
								label: "depth",
								labelCode: true,
								value: "2",
								code: true,
							},
						],
					},
				]}
			/>,
		);
		const root = container.querySelector("[data-cds=Collapsible]")!;
		const nested = root.querySelector("ul")!;
		expect(
			{
				rootClass: root.className,
				srOnly: [...root.querySelectorAll(".sr-only")].map((span) => span.textContent),
				nestedClass: nested.className,
				labelledBy: document.getElementById(nested.getAttribute("aria-labelledby")!)?.textContent,
				leaves: nested.querySelectorAll("li").length,
			},
		).toStrictEqual(
			{
				rootClass: "flex flex-col gap-0.75",
				srOnly: ["Group:", "(1 field)"],
				nestedClass: "flex flex-col gap-0.75 @max-[420px]:gap-2 ms-2 border-s border-alpha-3 ps-2",
				labelledBy: "Opts",
				leaves: 1,
			},
		);
	});

	it("folds a group, showing its field count and hiding the panel until found", async () =>
	{
		const {container} = render(
			<PermissionRowsList
				rows={[
					{
						label: "Opts",
						rows: [
							{
								label: "a",
								labelCode: true,
								value: "1",
								code: true,
							},
							{
								label: "b",
								labelCode: true,
								value: "2",
								code: true,
							},
						],
					},
				]}
			/>,
		);
		await actAndSettle(() =>
		{
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: /Opts/,
					},
				),
			);
		});
		const count = [...container.querySelectorAll("span")].find((span) => span.textContent === "(2 fields)")!;
		expect(
			{
				count: count.className,
				hidden: container.querySelector("[data-cds=Collapsible] [hidden]")?.getAttribute("hidden"),
			},
		).toStrictEqual(
			{
				count: "shrink-0 whitespace-nowrap",
				hidden: "until-found",
			},
		);
	});

	it("draws an unfoldable group as a plain label and list", () =>
	{
		const {container} = render(
			<PermissionRowsList
				foldable={false}
				rows={[
					{
						label: "Opts",
						rows: [
							{
								label: "a",
								labelCode: true,
								value: "1",
								code: true,
							},
						],
					},
				]}
			/>,
		);
		const group = container.querySelector("ul > li > div")!;
		expect(
			{
				className: group.className,
				children: [...group.children].map((child) => child.tagName),
				collapsible: container.querySelector("[data-cds=Collapsible]"),
			},
		).toStrictEqual(
			{
				className: "flex flex-col gap-0.75",
				children: ["SPAN", "UL"],
				collapsible: null,
			},
		);
	});

	it("clamps a long value to 6 lines behind Show more / Show less", () =>
	{
		class OverflowingResizeObserver
		{
			observe(): void
			{
			}
			unobserve(): void
			{
			}
			disconnect(): void
			{
			}
		}
		vi.stubGlobal("ResizeObserver", OverflowingResizeObserver);
		vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
		vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
		const {container} = render(
			<PermissionRowsList
				rows={[
					{
						label: "Prompt",
						value: "long",
						clampLines: 6,
					},
				]}
			/>,
		);
		const value = () => container.querySelector("[data-approval-value]")!;
		const before =
		{
			clamped: value().classList.contains("line-clamp-6"),
			button: screen.getByRole("button").textContent,
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show more",
				},
			),
		);
		const button = screen.getByRole("button");
		expect(
			{
				before,
				after:
				{
					clamped: value().classList.contains("line-clamp-6"),
					text: button.textContent,
					expanded: button.getAttribute("aria-expanded"),
					wrapper: value().parentElement!.className,
				},
			},
		).toStrictEqual(
			{
				before:
				{
					clamped: true,
					button: "Show more",
				},
				after:
				{
					clamped: false,
					text: "Show less",
					expanded: "true",
					wrapper: "flex min-w-0 flex-col gap-0.5",
				},
			},
		);
		vi.restoreAllMocks();
	});

	it("does not clamp when clamp is off", () =>
	{
		const {container} = render(
			<PermissionRowsList
				clamp={false}
				rows={[
					{
						label: "Prompt",
						value: "long",
						clampLines: 6,
					},
				]}
			/>,
		);
		expect(container.querySelector("[data-approval-value]")!.classList.contains("line-clamp-6")).toBe(false);
	});
});

describe("PermissionCard rows", () =>
{
	it("draws trail rows in the What Claude sent panel at the end of the body", () =>
	{
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "run an agent",
					meta: null,
				}}
				detail={null}
				description="Find x"
				rows={[
					{
						label: "Prompt",
						value: "Look",
					},
				]}
				rowsTrail
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		const body = container.querySelector("[data-approval-card-body] > div")!;
		const panel = body.lastElementChild!;
		expect(
			{
				panel: panel.hasAttribute("data-permission-rows-panel"),
				className: panel.className,
				head: [panel.firstElementChild!.className, panel.firstElementChild!.getAttribute("aria-hidden")],
				headText: panel.firstElementChild!.textContent,
			},
		).toStrictEqual(
			{
				panel: true,
				className: "flex flex-col gap-1 rounded-lg bg-alpha-1 px-3 py-2",
				head: ["text-footnote text-muted-as-secondary", "true"],
				headText: "What Claude sent",
			},
		);
	});

	it("draws bare rows after the detail-first detail and the description", () =>
	{
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "search files",
					meta: null,
				}}
				detail="foo"
				detailFirst
				description="Look"
				rows={[
					{
						label: "Path",
						value: "src",
					},
				]}
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		const body = container.querySelector("[data-approval-card-body] > div")!;
		expect([...body.children].map((child) => child.tagName + child.textContent)).toStrictEqual([
			"DIVfoo",
			"DIVLook",
			"ULPathsrc",
		]);
	});
});
