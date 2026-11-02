// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionLinkChip} from "../src/components/session-link-chip";
import
{
	CHIP_BASE,
	CHIP_INTERACTIVE,
	CHIP_MUTED,
	CHIP_STATIC,
	CHIP_TEXT,
} from "../src/components/session-link-chip-classes";

afterEach(() =>
{
	cleanup();
});

async function renderInRouter(node: ReactNode): Promise<HTMLElement>
{
	const rootRoute = createRootRoute(
		{
			component: () => <div data-testid="host">{node}</div>,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute,
			history: createMemoryHistory(
				{
					initialEntries: ["/"],
				},
			),
		},
	);
	await router.load();
	const view = render(<RouterProvider router={router} />);
	return await vi.waitFor(() =>
	{
		const host = view.container.querySelector<HTMLElement>("[data-testid=host]");
		if (!host) throw new Error("router not rendered");
		return host;
	});
}

describe("session link chip classes", () =>
{
	it("copies upstream's on/sn/cn/fn/mn class constants with local tokens", () =>
	{
		expect(
			{
				CHIP_BASE,
				CHIP_TEXT,
				CHIP_INTERACTIVE,
				CHIP_STATIC,
				CHIP_MUTED,
			},
		).toStrictEqual(
			{
				CHIP_BASE:
					"epitaxy-link-chip inline-flex max-w-full items-center rounded-sm bg-upstream-accent-muted px-1.5 align-baseline leading-tight",
				CHIP_TEXT:
					"epitaxy-link-chip inline-flex max-w-full items-center rounded-sm bg-upstream-accent-muted px-1.5 align-baseline leading-tight text-upstream-accent no-underline",
				CHIP_INTERACTIVE:
					"epitaxy-link-chip inline-flex max-w-full items-center rounded-sm bg-upstream-accent-muted px-1.5 align-baseline leading-tight text-upstream-accent no-underline hover:bg-upstream-accent-pressed data-[menu-open]:bg-upstream-accent-pressed focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus",
				CHIP_STATIC:
					"epitaxy-link-chip inline-flex max-w-full items-center rounded-sm bg-upstream-accent-muted px-1.5 align-baseline leading-tight text-upstream-accent no-underline data-[menu-open]:bg-upstream-accent-pressed",
				CHIP_MUTED:
					"epitaxy-link-chip inline-flex max-w-full items-center rounded-sm bg-upstream-accent-muted px-1.5 align-baseline leading-tight text-muted-as-secondary no-underline",
			},
		);
	});
});

describe("SessionLinkChip", () =>
{
	it("(a) renders a running in-app chip as a link with aria-busy and an sr-only status", async () =>
	{
		const host = await renderInRouter(
			<SessionLinkChip sessionId="u1" title="Fix the login bug" state="running" internalTo="/session/u1" />,
		);
		expect(host.innerHTML).toBe(
			`<a aria-busy="true" href="/session/u1" class="${CHIP_INTERACTIVE}"><span class="self-baseline truncate"><span>Fix the login bug</span><span class="contents"><span class="sr-only select-none"> — Running</span></span></span></a>`,
		);
	});

	it("(b) leaves an idle chip without aria-busy or an sr-only status", () =>
	{
		const {container} = render(
			<SessionLinkChip sessionId="u1" title="Fix" state="idle" onClick={() => undefined} />,
		);
		expect(container.innerHTML).toBe(
			`<button type="button" class="${CHIP_INTERACTIVE}"><span class="self-baseline truncate"><span>Fix</span></span></button>`,
		);
	});

	it("(c) marks the chip for the open session aria-current and a menu-open chip data-menu-open", () =>
	{
		const {container} = render(
			<SessionLinkChip sessionId="u1" title="Fix" state="awaiting" isOpen menuOpen onClick={() => undefined} />,
		);
		expect(container.innerHTML).toBe(
			`<button type="button" aria-current="true" data-menu-open="" class="${CHIP_INTERACTIVE}"><span class="self-baseline truncate"><span>Fix</span><span class="contents"><span class="sr-only select-none"> — Awaiting permission</span></span></span></button>`,
		);
	});

	it("(d) renders a words-only chip as a static span with no handler, status or current", () =>
	{
		const onClick = vi.fn<() => void>();
		const {container} = render(
			<SessionLinkChip sessionId="u1" title="Old work" state="running" isOpen wordsOnly onClick={onClick} />,
		);
		expect(container.innerHTML).toBe(
			`<span class="${CHIP_STATIC}"><span class="self-baseline truncate"><span>Old work</span></span></span>`,
		);
	});

	it("(e) renders a writing chip as the muted span, dropping its link but keeping the status", () =>
	{
		const {container} = render(
			<SessionLinkChip
				sessionId="u1"
				title="Fix"
				state="running"
				writing
				href="https://claude.ai/code/session_01ABCDEF"
			/>,
		);
		expect(container.innerHTML).toBe(
			`<span aria-busy="true" class="${CHIP_MUTED}" data-chip-muted=""><span class="self-baseline truncate"><span>Fix</span><span class="contents"><span class="sr-only select-none"> — Running</span></span></span></span>`,
		);
	});

	it("(f) renders the title's strong and code through the restricted inline markdown", () =>
	{
		const {container} = render(
			<SessionLinkChip sessionId="u1" title={"**Fix** `a.ts` - [x](y) <b>"} onClick={() => undefined} />,
		);
		expect(container.querySelector(".truncate > span")?.innerHTML).toBe(
			`<strong>Fix</strong> <code class="font-mono-ui">a.ts</code> - [x](y) &lt;b&gt;`,
		);
	});

	it("(g) labels a bare pasted session URL with no known title 'session'", () =>
	{
		const {container} = render(
			<SessionLinkChip sessionId="session_01ABCDEF" href="https://claude.ai/code/session_01ABCDEF">
				https://claude.ai/code/session_01ABCDEF
			</SessionLinkChip>,
		);
		expect(container.innerHTML).toBe(
			`<a href="https://claude.ai/code/session_01ABCDEF" target="_blank" rel="noreferrer" class="${CHIP_INTERACTIVE}"><span class="self-baseline truncate"><span>session</span></span></a>`,
		);
	});

	it("labels with the children when labelSource is children or there is no title", () =>
	{
		const {container} = render(
			<SessionLinkChip sessionId="u1" title="Ignored" labelSource="children" href="https://example.test/x">
				see here
			</SessionLinkChip>,
		);
		expect(container.querySelector(".truncate > span")?.textContent).toBe("see here");
	});

	it("(h) activates an anchor chip on Space keyup, once per press", () =>
	{
		const {container} = render(
			<SessionLinkChip sessionId="session_01ABCDEF" title="Fix" href="https://claude.ai/code/session_01ABCDEF" />,
		);
		const anchor = container.querySelector("a");
		if (!anchor) throw new Error("Expected an anchor chip");
		const clicks = vi.fn<(event: Event) => void>((event) =>
		{
			event.preventDefault();
		});
		anchor.addEventListener("click", clicks);

		act(() =>
		{
			fireEvent.keyDown(
				anchor,
				{
					key: " ",
				},
			);
			fireEvent.keyDown(
				anchor,
				{
					key: " ",
					repeat: true,
				},
			);
		});
		expect(anchor.dataset["spaceDown"]).toBe("");
		act(() =>
		{
			fireEvent.keyUp(
				anchor,
				{
					key: " ",
				},
			);
			fireEvent.keyUp(
				anchor,
				{
					key: " ",
				},
			);
		});
		expect(clicks).toHaveBeenCalledTimes(1);

		act(() =>
		{
			fireEvent.keyDown(
				anchor,
				{
					key: " ",
				},
			);
			fireEvent.keyDown(
				anchor,
				{
					key: "a",
				},
			);
			fireEvent.keyUp(
				anchor,
				{
					key: " ",
				},
			);
		});
		expect(clicks).toHaveBeenCalledTimes(1);
	});
});

describe("session link chip CSS", () =>
{
	it("strikes a chip inside del/s and defines font-mono-ui", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8").replaceAll(/\s+/g, " ");
		expect(
			[
				":is(del, s) .epitaxy-link-chip { position: relative; }",
				':is(del, s) .epitaxy-link-chip::after { content: ""; position: absolute; inset-inline: 0; top: 50%; border-top: 1px solid currentColor; pointer-events: none; }',
				"--font-mono-ui: var(--font-mono);",
			].filter((rule) => !styles.includes(rule)),
		).toStrictEqual([]);
	});
});
