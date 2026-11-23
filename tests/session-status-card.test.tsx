// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionStatusCard} from "../src/components/session-status-card";
import {DensityContext} from "../src/components/ui/density-context";
import type {StatusGroup, StatusRow} from "../src/lib/session-status-card";

const SESSION_ID = "8f1c2d3e-4b5a-4c6d-8e7f-001122334455";

const GROUPS: StatusGroup[] = [
	{
		id: "session",
		label: "Session",
		rows: [
			{
				id: "model",
				label: "Model",
				value: "Opus 4.7 · High",
				fullValue: "claude-opus-4-7 · High",
			},
			{
				id: "permissions",
				label: "Permissions",
				value: "Manual",
			},
			{
				id: "sessionId",
				label: "Session ID",
				value: SESSION_ID,
				copyable: true,
			},
		],
	},
	{
		id: "account",
		label: "Account",
		rows: [
			{
				id: "account",
				label: "Signed in as",
				value: "craig@x.com · Pro",
				hint: "Managed by your organization",
			},
		],
	},
];

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

beforeEach(() =>
{
	writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
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
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

function card(): HTMLElement
{
	return screen.getByTestId("epitaxy-status-card");
}

describe("SessionStatusCard", () =>
{
	it("draws upstream's card, group and row structure with each value's class and title", () =>
	{
		render(<SessionStatusCard groups={GROUPS} />);
		const root = card();
		const header = root.children.item(0);
		const body = root.children.item(1);
		const sessionGroup = body?.children.item(0);
		const rowsOf = (group: Element | null | undefined) =>
			[...(group?.children.item(1)?.children ?? [])].map((row) =>
			{
				const value = row.querySelector("[title]");
				return {
					className: row.className,
					label: [row.children.item(0)?.className, row.children.item(0)?.textContent],
					cell: row.children.item(1)?.className,
					stack: row.children.item(1)?.children.item(0)?.className,
					value: [value?.className, value?.getAttribute("title"), value?.textContent],
					inner: value?.firstElementChild
						? [
								value.firstElementChild.className,
								value.firstElementChild.firstElementChild?.tagName,
								value.firstElementChild.firstElementChild?.getAttribute("dir"),
								value.firstElementChild.firstElementChild?.className,
								value.firstElementChild.firstElementChild?.textContent,
							]
						: null,
					hint: value?.nextElementSibling?.className ?? null,
					button: row.querySelector("button")?.getAttribute("aria-label") ?? null,
				};
			});

		expect(
			{
				root: root.className,
				header: [header?.tagName, header?.className, header?.firstChild?.textContent],
				headerButton: header?.querySelector("button")?.getAttribute("aria-label"),
				body: body?.className,
				group: sessionGroup?.className,
				groupLabel: [sessionGroup?.children.item(0)?.className, sessionGroup?.children.item(0)?.textContent],
				rowsBox: sessionGroup?.children.item(1)?.className,
				session: rowsOf(sessionGroup),
				account: rowsOf(body?.children.item(1)),
			},
		).toStrictEqual(
			{
				root: "flex flex-col gap-md p-lg rounded-lg w-[360px] max-w-full card-ring",
				header: [
					"SPAN",
					"flex items-center justify-between text-footnote text-primary pb-xs min-h-[24px]",
					"Session info",
				],
				headerButton: "Copy session info",
				body: "flex flex-col gap-lg",
				group: "flex flex-col gap-1.5",
				groupLabel: ["text-footnote text-secondary font-medium", "Session"],
				rowsBox: "flex flex-col gap-1.5 text-footnote",
				session: [
					{
						className: "flex items-baseline justify-between gap-3",
						label: ["text-muted-as-secondary shrink-0", "Model"],
						cell: "min-w-0 flex items-center justify-end gap-1.5 text-end",
						stack: "min-w-0 flex flex-col items-end",
						value: ["min-w-0 max-w-full truncate", "claude-opus-4-7 · High", "Opus 4.7 · High"],
						inner: null,
						hint: null,
						button: null,
					},
					{
						className: "flex items-baseline justify-between gap-3",
						label: ["text-muted-as-secondary shrink-0", "Permissions"],
						cell: "min-w-0 flex items-center justify-end gap-1.5 text-end",
						stack: "min-w-0 flex flex-col items-end",
						value: ["min-w-0 [overflow-wrap:anywhere]", "Manual", "Manual"],
						inner: null,
						hint: null,
						button: null,
					},
					{
						className: "flex items-baseline justify-between gap-3",
						label: ["text-muted-as-secondary shrink-0", "Session ID"],
						cell: "min-w-0 flex items-center justify-end gap-1.5 text-end",
						stack: "min-w-0 flex flex-col items-end",
						value: ["min-w-0 max-w-full font-mono-ui", SESSION_ID, SESSION_ID],
						inner: [
							"block truncate [direction:rtl]",
							"BDI",
							"ltr",
							"[direction:inherit] [unicode-bidi:plaintext]",
							SESSION_ID,
						],
						hint: null,
						button: "Copy session ID",
					},
				],
				account: [
					{
						className: "flex items-baseline justify-between gap-3",
						label: ["text-muted-as-secondary shrink-0", "Signed in as"],
						cell: "min-w-0 flex items-center justify-end gap-1.5 text-end",
						stack: "min-w-0 flex flex-col items-end",
						value: ["min-w-0 [overflow-wrap:anywhere]", "craig@x.com · Pro", "craig@x.com · Pro"],
						inner: null,
						hint: "max-w-full text-muted-as-secondary [overflow-wrap:anywhere]",
						button: null,
					},
				],
			},
		);
	});

	it("wraps the MCP servers summary instead of truncating it and follows it with Manage", () =>
	{
		const onManageMcp = vi.fn<() => void>();
		const summary = "1 connected (a) · 1 failed (imcp)";
		render(
			<SessionStatusCard
				groups={[
					{
						id: "environment",
						label: "Environment",
						rows: [
							{
								id: "mcp",
								label: "MCP servers",
								value: summary,
								fullValue: summary,
							},
						],
					},
				]}
				onManageMcp={onManageMcp}
			/>,
		);
		const row = card().querySelector(".flex.items-baseline");
		const cell = row?.children.item(1);
		const manage = cell?.children.item(1);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Manage",
				},
			),
		);

		expect(
			{
				value: [...(cell?.querySelectorAll("[title]") ?? [])].map((el) => [
					el.className,
					el.getAttribute("title"),
					el.textContent,
				]),
				manage: [manage?.tagName, manage?.className],
				link: [
					manage?.firstElementChild?.tagName,
					manage?.firstElementChild?.getAttribute("data-cds"),
					manage?.firstElementChild?.className,
					manage?.firstElementChild?.textContent,
				],
				calls: onManageMcp.mock.calls.length,
			},
		).toStrictEqual(
			{
				value: [["min-w-0 [overflow-wrap:anywhere]", summary, summary]],
				manage: ["SPAN", "shrink-0 text-muted-as-secondary"],
				link: ["BUTTON", "TextLink", "cds-reset text-link-inherit", "Manage"],
				calls: 1,
			},
		);
	});

	it("clips the folder path's directory and keeps its basename, or truncates a slashless value whole", () =>
	{
		const folderRow = (value: string, fullValue: string): StatusRow => (
		{
			id: "folder",
			label: "Folder",
			value,
			fullValue,
		});
		render(
			<SessionStatusCard
				groups={[
					{
						id: "environment",
						label: "Environment",
						rows: [
							folderRow("~/projects/claude-code-plans", "/Users/me/projects/claude-code-plans"),
							folderRow("scratch", "/scratch"),
						],
					},
				]}
			/>,
		);
		const shape = (el: Element): unknown => (
		{
			tag: el.tagName,
			className: el.className,
			title: el.getAttribute("title"),
			dir: el.getAttribute("dir"),
			ariaLabel: el.getAttribute("aria-label"),
			children: el.children.length > 0 ? [...el.children].map(shape) : el.textContent,
		});

		expect([...card().querySelectorAll(".flex.items-baseline [title]")].map(shape)).toStrictEqual([
			{
				tag: "SPAN",
				className: "flex min-w-0 max-w-full",
				title: "/Users/me/projects/claude-code-plans",
				dir: null,
				ariaLabel: null,
				children: [
					{
						tag: "SPAN",
						className: "relative flex min-w-0 overflow-hidden whitespace-nowrap",
						title: null,
						dir: "ltr",
						ariaLabel: "~/projects/claude-code-plans",
						children: [
							{
								tag: "SPAN",
								className: "min-w-0 overflow-hidden",
								title: null,
								dir: null,
								ariaLabel: null,
								children: "~/projects/",
							},
							{
								tag: "SPAN",
								className: "max-w-full shrink-0 truncate",
								title: null,
								dir: null,
								ariaLabel: null,
								children: "claude-code-plans",
							},
						],
					},
				],
			},
			{
				tag: "SPAN",
				className: "flex min-w-0 max-w-full",
				title: "/scratch",
				dir: null,
				ariaLabel: null,
				children: [
					{
						tag: "SPAN",
						className: "relative flex min-w-0 overflow-hidden whitespace-nowrap",
						title: null,
						dir: "ltr",
						ariaLabel: null,
						children: [
							{
								tag: "SPAN",
								className: "min-w-0 truncate",
								title: null,
								dir: null,
								ariaLabel: null,
								children: "scratch",
							},
						],
					},
				],
			},
		]);
	});

	it("shows Loading session info… and no Copy button before any group arrives", () =>
	{
		render(<SessionStatusCard groups={[]} />);

		expect(
			{
				body: [
					card().children.item(1)?.tagName,
					card().children.item(1)?.className,
					card().children.item(1)?.textContent,
				],
				buttons: card().querySelectorAll("button").length,
			},
		).toStrictEqual(
			{
				body: ["SPAN", "text-footnote text-muted-as-secondary", "Loading session info…"],
				buttons: 0,
			},
		);
	});

	it("copies the report from the header and the full id from its row, each showing Copied for 1200ms", async () =>
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-06T12:00:00.000Z"));
		render(<SessionStatusCard groups={GROUPS} />);
		const header = screen.getByRole(
			"button",
			{
				name: "Copy session info",
			},
		);
		const row = screen.getByRole(
			"button",
			{
				name: "Copy session ID",
			},
		);
		const mouseDown = fireEvent.mouseDown(header);

		await act(async () =>
		{
			fireEvent.click(row);
			await Promise.resolve();
		});
		const afterRow = [header.getAttribute("aria-label"), row.getAttribute("aria-label")];
		act(() =>
		{
			vi.advanceTimersByTime(1200);
		});
		const afterTimeout = [header.getAttribute("aria-label"), row.getAttribute("aria-label")];
		await act(async () =>
		{
			fireEvent.click(header);
			await Promise.resolve();
		});

		expect(
			{
				mouseDownKept: mouseDown,
				afterRow,
				afterTimeout,
				afterHeader: [header.getAttribute("aria-label"), row.getAttribute("aria-label")],
				copied: writeText.mock.calls,
			},
		).toStrictEqual(
			{
				mouseDownKept: false,
				afterRow: ["Copy session info", "Copied"],
				afterTimeout: ["Copy session info", "Copy session ID"],
				afterHeader: ["Copied", "Copy session ID"],
				copied: [
					[SESSION_ID],
					[
						[
							"Claude Code session info (2026-11-06T12:00:01.200Z)",
							"",
							"Session:",
							"- Model: claude-opus-4-7 · High",
							"- Permissions: Manual",
							`- Session ID: ${SESSION_ID}`,
							"",
							"Account:",
							"- Signed in as: craig@x.com · Pro (Managed by your organization)",
						].join("\n"),
					],
				],
			},
		);
	});

	it("sizes the ghost buttons 24px and 20px when compact and 28px when comfortable", () =>
	{
		const sizes = () =>
			[...card().querySelectorAll("button")].map((button) =>
				button.className.split(" ").find((c) => c.startsWith("size-")),
			);
		const {rerender} = render(
			<DensityContext.Provider value="compact">
				<SessionStatusCard groups={GROUPS} />
			</DensityContext.Provider>,
		);
		const compact = sizes();
		rerender(
			<DensityContext.Provider value="comfortable">
				<SessionStatusCard groups={GROUPS} />
			</DensityContext.Provider>,
		);

		expect(
			{
				compact,
				comfortable: sizes(),
			},
		).toStrictEqual(
			{
				compact: ["size-6", "size-5"],
				comfortable: ["size-7", "size-7"],
			},
		);
	});
});
