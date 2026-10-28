// @vitest-environment jsdom

import {act, createElement, type ReactElement, type ReactNode, useLayoutEffect} from "react";
import {hydrateRoot} from "react-dom/client";
import {renderToStaticMarkup} from "react-dom/server";
import {render} from "@testing-library/react";
import {describe, expect, it, vi} from "vite-plus/test";
import {AppShellFallback} from "../src/components/app-shell-fallback";
import {getVisibleNavItems, navItems} from "../src/components/sidebar/navigation";
import {SidebarSearchField} from "../src/components/sidebar/sidebar-search-field";
import {DEFAULT_VISIBLE_NAV_SECTIONS} from "../src/lib/nav-sections";
import {Route} from "../src/routes/__root";
import {resolveShellChinLabels} from "../src/lib/shell-chin-labels";
import {getShellChinLabels, setShellChinLabels} from "../src/lib/shell-chin-store";
import {
	ADD_BUTTON_CLASS,
	CHIN_TRIGGER_CLASS,
	COMPOSER_CARD_CLASS,
	COMPOSER_CHIN_CLASS,
	EFFORT_LABEL_CLASS,
	ENVIRONMENT_BAR_CLASS,
	ENVIRONMENT_BAR_ROW_CLASS,
	ENVIRONMENT_PLACE_CLASS,
	PLACE_CHIP_CLASS,
	USAGE_RING_CLASS,
} from "../src/components/composer-tokens";
import {
	HOME_DOCK_CLASS,
	SESSION_DOCK_COLUMN_CLASS,
	SESSION_FOOTER_CLASS,
	SESSION_TILE_CLASS,
} from "../src/components/dock-tokens";

/** Hydrates the client's fallback, which has no labels, and reports its chin before the fallback removes itself. */
function ProbeFallback({onHydrated}: {onHydrated: (chin: Element) => void}) {
	useLayoutEffect(() => {
		onHydrated(document.querySelector('[data-cds="ChatComposerChin"]')!);
	});
	return <AppShellFallback />;
}

/** The composer's readouts in order: "+" for the card's add icon, then each chin label's text. */
function chinReadouts(chin: Element): string[] {
	const composer = chin.closest('[data-cds="ChatComposer"]')!;
	return Array.from(composer.querySelectorAll("[data-fallback-chin-readout]"), (node) =>
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

	it("sizes the frame to the dynamic viewport rather than 100vh", () => {
		const html = renderToStaticMarkup(<AppShellFallback />);
		const root = new DOMParser().parseFromString(html, "text/html").getElementById("app-shell-fallback");

		expect(root?.className.split(" ").filter((name) => name.startsWith("h-"))).toStrictEqual([
			"h-[var(--app-visual-viewport-height,100dvh)]",
		]);
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
			footerIcons: sidebar.querySelectorAll('[data-testid="sidebar-footer"] svg').length,
			composer: host.querySelector('[data-cds="ChatComposer"]') !== null,
			column: host.querySelector(".chat-column") !== null,
		}).toStrictEqual({
			wordmark: "Claude Code Browser",
			oldLogo: false,
			oldSearchBox: false,
			rows: ["New", ...pinned, "More"],
			sessionRows: 8,
			footer: true,
			footerIcons: 0,
			composer: true,
			column: true,
		});
	});

	it("paints the sidebar Search field above New with the live field's wrapper, row classes, label and keycaps, so New does not shift on hydration", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback />);
		const live = document.createElement("div");
		live.innerHTML = renderToStaticMarkup(<SidebarSearchField />);
		const field = host.querySelector('[aria-label="Sidebar"] .df-search-field')!;
		const liveField = live.querySelector(".df-search-field")!;
		const firstRow = field.parentElement!.parentElement!.firstElementChild;
		const newRow = field.parentElement!.nextElementSibling;

		expect({
			tag: field.tagName.toLowerCase(),
			wrapper: field.parentElement!.className,
			className: field.className,
			label: field.querySelector("[data-row-label]")?.textContent,
			keycaps: Array.from(field.querySelectorAll("kbd"), (key) => key.textContent),
			first: firstRow === field.parentElement,
			next: newRow?.textContent,
		}).toStrictEqual({
			tag: "span",
			wrapper: liveField.parentElement!.className,
			className: liveField.className,
			label: "Search",
			keycaps: Array.from(liveField.querySelectorAll("kbd"), (key) => key.textContent),
			first: true,
			next: "New",
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
			box: COMPOSER_CARD_CLASS,
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
			fastMode: false,
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
				fastMode: false,
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
			shell: shell.includes(">Plan<") && shell.includes(">Opus 5.5<") && shell.includes("> Max<"),
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

	it("paints the home layout on the home route: the New session titlebar, Sessions rows and the home composer, with no session skeleton", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback pathname="/" />);
		const home = host.querySelector('[data-testid="home-skeleton"]');

		expect({
			home: home !== null,
			title: home?.querySelector("h1")?.textContent,
			sessions: home?.querySelector("h2")?.textContent,
			rows: home?.querySelectorAll("[data-home-skeleton-row]").length,
			composer: host.querySelector("[data-fallback-composer]")?.textContent,
			sessionSkeleton: host.querySelector('[data-testid="session-skeleton"]'),
		}).toStrictEqual({
			home: true,
			title: "New session",
			sessions: "Sessions",
			rows: 5,
			composer: "Describe a task or ask a question",
			sessionSkeleton: null,
		});
	});

	it("paints the artifacts page's own skeleton on /artifacts: a compact header, tab row and card grid in the gutter-less route with the page's own 8px/32px box, with no session skeleton or composer", () => {
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
			gutter: skeleton?.children[1]?.className,
			box: skeleton?.children[1]?.firstElementChild?.className,
			composer: host.querySelector("[data-fallback-composer]"),
			sessionSkeleton: host.querySelector('[data-testid="session-skeleton"]'),
		}).toStrictEqual({
			skeleton: true,
			cards: 6,
			grid: true,
			gutter: "",
			box: "mx-auto flex sm:-mt-1 w-full max-w-5xl flex-col px-2 md:px-8",
			composer: null,
			sessionSkeleton: null,
		});
	});

	it("lays the home skeleton in the same tile shell as the loaded home page, titlebar first, so it does not jump", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback pathname="/" />);
		const home = host.querySelector('[data-testid="home-skeleton"]');
		const shell = home?.parentElement?.parentElement;

		expect({
			shell: shell?.hasAttribute("data-route-tile-shell"),
			homeFirst: shell?.firstElementChild?.firstElementChild === home,
			tileSlot: home?.className.split(" ").includes("@container/tile-slot"),
			titlebar: home?.firstElementChild?.className,
		}).toStrictEqual({
			shell: true,
			homeFirst: true,
			tileSlot: true,
			titlebar: "flex h-8 shrink-0 items-center ps-[var(--tile-title-start,0px)] pe-12",
		});
	});

	it("paints the live composer's tokens so hydration does not jump: the card, a 28px line beside the 28px Add, the 13/20 chin, its 24px triggers with the effort in a muted span, and the 14px ring", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(
			<AppShellFallback
				chin={resolveShellChinLabels({
					model: "opus",
					effortLevel: "high",
					defaultMode: "auto",
					bypassPermissionsAllowed: false,
					fastMode: false,
				})}
			/>,
		);
		const card = host.querySelector("[data-fallback-composer]")!;
		const chin = host.querySelector('[data-cds="ChatComposerChin"]')!;
		const [mode, model] = Array.from(chin.querySelectorAll("[data-fallback-chin-readout]"));
		const ring = chin.querySelector("[data-fallback-chin-end] > span:last-child");

		expect({
			card: card.className,
			line: card.querySelector("[data-fallback-placeholder]")?.className,
			add: card.querySelector("[data-fallback-add]")?.className,
			addIcon: card.querySelector("[data-fallback-add] svg")?.getAttribute("class"),
			chin: chin.className,
			mode: mode?.className,
			model: model?.className,
			modelSpans: Array.from(model?.children ?? [], (span) => [span.className, span.textContent]),
			ring: ring?.className,
			ringSize: [
				ring?.querySelector("svg")?.getAttribute("width"),
				ring?.querySelector("svg")?.getAttribute("height"),
			],
		}).toStrictEqual({
			card: COMPOSER_CARD_CLASS,
			line: "block py-1 pl-1 text-[14px]/[20px] text-[rgb(137,135,129)]",
			add: ADD_BUTTON_CLASS,
			addIcon: "lucide lucide-plus size-[18px]",
			chin: COMPOSER_CHIN_CLASS,
			mode: CHIN_TRIGGER_CLASS,
			model: CHIN_TRIGGER_CLASS,
			modelSpans: [
				["truncate", "Opus 5.5"],
				[EFFORT_LABEL_CLASS, " High"],
			],
			ring: USAGE_RING_CLASS,
			ringSize: ["14", "14"],
		});
	});
});

describe("AppShellFallback dock frame", () => {
	it("docks the session composer where the hydrated one lands: the session tile shell, the chat tile, the footer, its pt-2 and the dock column", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(<AppShellFallback pathname="/session/example-alice" />);
		const composer = host.querySelector('[data-cds="ChatComposer"]')!;
		const dock = composer.parentElement;
		const gap = dock?.parentElement;
		const footer = gap?.parentElement;
		const tile = footer?.parentElement;

		expect({
			dock: dock?.className,
			gap: gap?.className,
			footer: footer?.className,
			tile: tile?.className,
			shell: tile?.parentElement?.parentElement?.getAttribute("data-route-tile-shell"),
			skeletonInTile: tile?.querySelector('[data-testid="session-skeleton"]') !== null,
			oldColumn: host.querySelector(".chat-column.pb-4"),
		}).toStrictEqual({
			dock: SESSION_DOCK_COLUMN_CLASS,
			gap: "pt-2",
			footer: SESSION_FOOTER_CLASS,
			tile: SESSION_TILE_CLASS,
			shell: "session",
			skeletonInTile: true,
			oldColumn: null,
		});
	});

	it("docks the home composer as the hydrated home does: the home dock's bottom inset, and the environment bar with a place chip before the mode instead of the chin", () => {
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(
			<AppShellFallback
				pathname="/"
				chin={resolveShellChinLabels({
					model: "opus",
					effortLevel: "high",
					defaultMode: "auto",
					bypassPermissionsAllowed: false,
					fastMode: false,
				})}
			/>,
		);
		const composer = host.querySelector('[data-cds="ChatComposer"]')!;
		const bar = composer.querySelector("[data-fallback-environment-bar]");
		const row = bar?.firstElementChild;
		const [place, mode, end] = Array.from(row?.children ?? []);

		expect({
			dock: composer.parentElement?.className,
			chin: composer.querySelector('[data-cds="ChatComposerChin"]'),
			bar: bar?.className,
			row: row?.className,
			place: place?.className,
			chip: place?.firstElementChild?.className,
			mode: mode?.textContent,
			end: end?.textContent,
			readouts: chinReadouts(bar!),
		}).toStrictEqual({
			dock: HOME_DOCK_CLASS,
			chin: null,
			bar: ENVIRONMENT_BAR_CLASS,
			row: ENVIRONMENT_BAR_ROW_CLASS,
			place: ENVIRONMENT_PLACE_CLASS,
			chip: PLACE_CHIP_CLASS,
			mode: "Auto",
			end: "Opus 5.5 High",
			readouts: ["+", "Auto", "Opus 5.5 High"],
		});
	});
});
