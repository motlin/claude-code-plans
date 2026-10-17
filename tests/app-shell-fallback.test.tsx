// @vitest-environment jsdom

import {act, createElement, type ReactElement, type ReactNode, useLayoutEffect} from "react";
import {hydrateRoot} from "react-dom/client";
import {renderToStaticMarkup} from "react-dom/server";
import {render} from "@testing-library/react";
import {describe, expect, it, vi} from "vite-plus/test";
import {AppShellFallback} from "../src/components/app-shell-fallback";
import {getVisibleNavItems, navItems} from "../src/components/sidebar/navigation";
import {DEFAULT_VISIBLE_NAV_SECTIONS} from "../src/lib/nav-sections";
import {Route} from "../src/routes/__root";
import {resolveShellChinLabels} from "../src/lib/shell-chin-labels";
import {getShellChinLabels, setShellChinLabels} from "../src/lib/shell-chin-store";

/** Hydrates the client's fallback, which has no labels, and reports its chin before the fallback removes itself. */
function ProbeFallback({onHydrated}: {onHydrated: (chin: Element) => void}) {
	useLayoutEffect(() => {
		onHydrated(document.querySelector('[data-cds="ChatComposerChin"]')!);
	});
	return <AppShellFallback />;
}

/** The chin's readouts in order: "+" for the add icon, then each label's text. */
function chinReadouts(chin: Element): string[] {
	return Array.from(chin.querySelectorAll("[data-fallback-chin-readout]"), (node) =>
		node.tagName.toLowerCase() === "svg" ? "+" : node.textContent,
	);
}

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		HeadContent: () => null,
		Scripts: () => null,
		// The shell picks the fallback layout from the requested path.
		useRouterState: ({select}: {select: (state: {location: {pathname: string}}) => unknown}) =>
			select({location: {pathname: "/session/example-alice"}}),
	};
});

// The root route owns `shellComponent`, so this markup is what the server sends
// for every route: /, /plugins, /tasks and the rest all share one shell. With
// `ssr: false` the routes themselves render nothing on the server, so the shell
// is the only thing that can paint before the client bundle hydrates.
type ShellComponent = (props: {children: ReactNode}) => ReactElement<{
	suppressHydrationWarning?: boolean;
}>;

// `Route.options` is typed as RouteOptions, which omits the root-only shell
// fields, so reaching the component the server renders needs a cast.
function getShellComponent(): ShellComponent {
	const {shellComponent} = Route.options as unknown as {shellComponent?: ShellComponent};
	if (!shellComponent) throw new Error("root route has no shellComponent");
	return shellComponent;
}

function renderServerShell(): string {
	return renderToStaticMarkup(createElement(getShellComponent(), null, null));
}

describe("server shell", () => {
	it("paints the app frame instead of an empty body", () => {
		const html = renderServerShell();
		const body = html.substring(html.indexOf("<body>"));

		expect({
			emptyBody: /<body>\s*<\/body>/.test(html),
			fallback: body.includes('data-testid="app-shell-fallback"'),
			sidebar: body.includes('aria-label="Sidebar"'),
			title: body.includes("Claude Code Browser"),
			skeleton: body.includes("animate-pulse"),
		}).toStrictEqual({
			emptyBody: false,
			fallback: true,
			sidebar: true,
			title: true,
			skeleton: true,
		});
	});

	it("resolves the theme before first paint so the frame is never a white flash", () => {
		const html = renderServerShell();
		const head = html.substring(0, html.indexOf("<body>"));

		expect({
			readsStoredTheme: head.includes('localStorage.getItem("theme")'),
			readsSystemTheme: head.includes("prefers-color-scheme"),
		}).toStrictEqual({
			readsStoredTheme: true,
			readsSystemTheme: true,
		});
	});

	// The theme script mutates <html> before React loads, so hydration always sees
	// attributes the server markup lacked. Without the opt-out that logs a
	// hydration error on every hard load.
	it("suppresses the hydration warning the theme script would otherwise trigger", () => {
		const document = getShellComponent()({children: null});

		expect(document.props.suppressHydrationWarning).toStrictEqual(true);
	});
});

describe("AppShellFallback", () => {
	it("renders the frame on the server", () => {
		expect(renderToStaticMarkup(<AppShellFallback />)).toContain('data-testid="app-shell-fallback"');
	});

	it("removes itself once the client hydrates", () => {
		const {container} = render(<AppShellFallback />);

		expect(container.innerHTML).toStrictEqual("");
	});

	it("paints the current shell's layout: serif wordmark, New row, nav and More, a session list, footer and composer", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback />);
		const sidebar = host.querySelector('[aria-label="Sidebar"]')!;
		const rows = Array.from(sidebar.querySelectorAll(".df-nav-row"), (row) => row.textContent);
		const pinned = getVisibleNavItems(navItems, DEFAULT_VISIBLE_NAV_SECTIONS).pinned.map((item) => item.label);

		expect({
			wordmark: sidebar.querySelector(".font-voice")?.textContent,
			oldLogo: host.innerHTML.includes("#C87B3A"),
			oldSearchBox: host.textContent.includes("Search..."),
			rows,
			sessionRows: sidebar.querySelectorAll("[data-fallback-session-row]").length,
			footer: sidebar.querySelector('[data-testid="sidebar-footer"]') !== null,
			composer: host.querySelector('[data-cds="ChatComposer"]') !== null,
			column: host.querySelector(".chat-column") !== null,
		}).toStrictEqual({
			wordmark: "Claude Code Browser",
			oldLogo: false,
			oldSearchBox: false,
			rows: ["New", ...pinned, "More"],
			sessionRows: 8,
			footer: true,
			composer: true,
			column: true,
		});
	});

	it("paints the same session skeleton as an in-app switch: the header dot and bar, a bubble and 10 line bars in the column", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback />);
		const skeleton = host.querySelector('[data-testid="session-skeleton"]');

		expect({
			skeleton: skeleton !== null,
			header: skeleton?.querySelectorAll("[data-skeleton-header] > div").length,
			bubbles: skeleton?.querySelectorAll("[data-skeleton-bubble]").length,
			lines: skeleton?.querySelectorAll("[data-skeleton-paragraph] > div").length,
			ownTranscriptBars: host.querySelectorAll(".chat-column.space-y-4").length,
		}).toStrictEqual({skeleton: true, header: 2, bubbles: 1, lines: 10, ownTranscriptBars: 0});
	});

	it("paints the composer as upstream does while loading: a 40px box with the session placeholder over a chin", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback />);
		const composer = host.querySelector('[data-cds="ChatComposer"]');
		const box = composer?.querySelector("[data-fallback-composer]");

		expect({
			placeholder: box?.textContent,
			box: box?.className,
			oldEmptyBox: composer?.querySelector(".min-h-\\[88px\\]") ?? null,
			chin: composer?.querySelector('[data-cds="ChatComposerChin"] svg') !== null,
		}).toStrictEqual({
			placeholder: "Type / for commands",
			box: "relative flex flex-col rounded-card bg-surface-3 p-2 shadow-[var(--composer-shadow-idle)]",
			oldEmptyBox: null,
			chin: true,
		});
	});

	it("fills the loading chin with the settings defaults the live chin shows: +, the mode, then model and effort beside the usage ring", () => {
		const host = document.createElement("div");
		const chin = resolveShellChinLabels({
			model: "opus",
			effortLevel: "high",
			defaultMode: "auto",
			bypassPermissionsAllowed: false,
		});
		host.innerHTML = renderToStaticMarkup(<AppShellFallback chin={chin} />);
		const chinRow = host.querySelector('[data-cds="ChatComposerChin"]')!;

		expect({
			readouts: chinReadouts(chinRow),
			ring: chinRow.querySelectorAll("[data-fallback-chin-end] svg circle").length,
		}).toStrictEqual({readouts: ["+", "Auto", "Opus 5.5 High"], ring: 1});
	});

	it("labels the loading chin as the live chin does when settings.json is missing", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback chin={resolveShellChinLabels(null)} />);

		expect(chinReadouts(host.querySelector('[data-cds="ChatComposerChin"]')!)).toStrictEqual([
			"+",
			"Manual",
			"Opus 5.5 High",
		]);
	});

	it("paints the server's chin labels from the shell, and the client keeps them through hydration", async () => {
		setShellChinLabels(
			resolveShellChinLabels({
				model: "opus",
				effortLevel: "max",
				defaultMode: "plan",
				bypassPermissionsAllowed: false,
			}),
		);
		const markup = renderToStaticMarkup(<AppShellFallback chin={getShellChinLabels()} />);
		const shell = renderServerShell();
		setShellChinLabels(null);
		const container = document.createElement("div");
		container.innerHTML = markup;
		document.body.append(container);
		const onRecoverableError = vi.fn<(error: unknown) => void>();
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		let hydratedReadouts: string[] = [];
		let root: ReturnType<typeof hydrateRoot> | undefined;
		await act(async () => {
			root = hydrateRoot(
				container,
				<ProbeFallback onHydrated={(chin) => (hydratedReadouts = chinReadouts(chin))} />,
				{
					onRecoverableError,
				},
			);
			await Promise.resolve();
		});
		act(() => {
			root?.unmount();
		});
		container.remove();
		errors.mockRestore();

		expect({
			shell: shell.includes(">Plan<") && shell.includes(">Opus 5.5 Max<"),
			hydratedReadouts,
			recoverableErrors: onRecoverableError.mock.calls.length,
			consoleErrors: errors.mock.calls.length,
		}).toStrictEqual({
			shell: true,
			hydratedReadouts: ["+", "Plan", "Opus 5.5 Max"],
			recoverableErrors: 0,
			consoleErrors: 0,
		});
	});

	it("paints the home layout on the home route: greeting, Sessions rows and the home composer, with no session skeleton", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback pathname="/" />);
		const home = host.querySelector('[data-testid="home-skeleton"]');

		expect({
			home: home !== null,
			greeting: home?.querySelector("h1")?.textContent,
			sessions: home?.querySelector("h2")?.textContent,
			rows: home?.querySelectorAll("[data-home-skeleton-row]").length,
			composer: host.querySelector("[data-fallback-composer]")?.textContent,
			sessionSkeleton: host.querySelector('[data-testid="session-skeleton"]'),
		}).toStrictEqual({
			home: true,
			greeting: "Welcome back",
			sessions: "Sessions",
			rows: 5,
			composer: "Describe a task or ask a question",
			sessionSkeleton: null,
		});
	});

	it("paints the artifacts page's own skeleton on /artifacts: a compact header, tab row and card grid, with no session skeleton or composer", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback pathname="/artifacts" />);
		const skeleton = host.querySelector('[data-testid="artifacts-skeleton"]');

		expect({
			skeleton: skeleton !== null,
			cards: skeleton?.querySelectorAll("[data-artifacts-skeleton-card]").length,
			grid: skeleton
				?.querySelector("[data-artifacts-skeleton-grid]")
				?.className.split(" ")
				.includes("md:grid-cols-3"),
			composer: host.querySelector("[data-fallback-composer]"),
			sessionSkeleton: host.querySelector('[data-testid="session-skeleton"]'),
		}).toStrictEqual({skeleton: true, cards: 6, grid: true, composer: null, sessionSkeleton: null});
	});

	it("lays the home skeleton in the same tile shell and title-bar spacer as the loaded home page, so the greeting does not jump", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback pathname="/" />);
		const home = host.querySelector('[data-testid="home-skeleton"]');
		const shell = home?.parentElement?.parentElement;

		expect({
			shell: shell?.hasAttribute("data-route-tile-shell"),
			spacer: shell?.firstElementChild?.className,
			homeAfterSpacer: shell?.firstElementChild?.nextElementSibling?.firstElementChild === home,
		}).toStrictEqual({shell: true, spacer: "h-9 shrink-0 sm:h-8", homeAfterSpacer: true});
	});
});
