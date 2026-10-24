// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FileRefsProvider, ProseMarkdown, SessionFileRefs} from "../src/components/file-refs";
import {FilesPaneView} from "../src/components/panes/files-pane";
import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {TruncatedFilePathHeader} from "../src/components/tool-renderers/shared";
import type {FileRef} from "../src/lib/file-refs";
import type {SessionFiles} from "../src/lib/session-files";
import {installLocalStorage} from "./fake-storage";

const EXISTING = ["/repo/.mise/config.toml", "/repo/src/app.ts"];
const OUTSIDE = new Set(["/tmp/outside/notes.txt"]);

const MISSING_REASON =
	"Couldn’t find this file, so it can’t be opened. You can ask Claude to create it or check the path.";
const OUTSIDE_REASON = "This file is outside this session’s folders, so it can’t be opened here.";

function fileRefStatus(path: string): "exists" | "missing" | "outside" {
	if (EXISTING.includes(path)) return "exists";
	return OUTSIDE.has(path) ? "outside" : "missing";
}

const EMPTY_SESSION_FILES = {
	files: [],
	totalCount: 0,
	counts: {
		userMessage: 0,
		agentMessage: 0,
		read: 0,
		editWrite: 0,
		bash: 0,
		grepGlob: 0,
		thinking: 0,
		other: 0,
	},
} satisfies SessionFiles;

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

const statRequests: string[][] = [];
/** How long `/api/file-refs` takes to answer, for the busy-state tests. */
let statDelayMs = 0;

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = String(input);
	if (url === "/api/file-refs") {
		const {paths} = JSON.parse(String(init?.body)) as {paths: string[]};
		statRequests.push(paths);
		if (statDelayMs > 0) {
			await new Promise((resolve) => {
				setTimeout(resolve, statDelayMs);
			});
		}
		return Promise.resolve(
			Response.json({statuses: Object.fromEntries(paths.map((path) => [path, fileRefStatus(path)]))}),
		);
	}
	if (url.startsWith("/api/file/")) {
		return Promise.resolve(Response.json({content: "[tools]\n", path: EXISTING[0]}));
	}
	return Promise.resolve(Response.json({error: "not found"}, {status: 404}));
}

function withQueryClient(children: ReactNode) {
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
	installLocalStorage();
	statRequests.length = 0;
	statDelayMs = 0;
	vi.stubGlobal("fetch", vi.fn(fakeFetch));
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
	);
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const MESSAGE = "Set it in `.mise/config.toml`, not `mise.toml`; logs go to `logs/`. See `src/app.ts:12-20`.";

describe("ProseMarkdown file refs", () => {
	it("links only inline code the server confirmed exists, as prose-link buttons without the code chip", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider value={{sessionId: "refs-test", cwd: "/repo", sessionPaths: [], open}}>
					<ProseMarkdown markdown={MESSAGE} />
				</FileRefsProvider>,
			),
		);

		await waitFor(() => {
			expect(container.querySelectorAll("[data-file-ref]")).toHaveLength(2);
		});
		const refs = [...container.querySelectorAll<HTMLElement>("[data-file-ref]")];
		expect({
			refs: refs.map((ref) => ({
				text: ref.textContent,
				role: ref.getAttribute("role"),
				tabIndex: ref.getAttribute("tabindex"),
				className: ref.className,
				title: ref.getAttribute("title"),
				hasCode: ref.querySelector("code") !== null,
			})),
			plainCode: [...container.querySelectorAll("code")].map((code) => code.textContent),
		}).toStrictEqual({
			refs: [
				{
					text: ".mise/config.toml",
					role: "button",
					tabIndex: "0",
					className: "prose-link",
					title: null,
					hasCode: false,
				},
				{
					text: "src/app.ts:12-20",
					role: "button",
					tabIndex: "0",
					className: "prose-link",
					title: null,
					hasCode: false,
				},
			],
			plainCode: ["mise.toml", "logs/"],
		});

		fireEvent.click(refs[0]!);
		fireEvent.keyDown(refs[1]!, {key: "Enter"});
		expect(open.mock.calls).toStrictEqual([
			[{path: "/repo/.mise/config.toml"}],
			[{path: "/repo/src/app.ts", line: 12, endLine: 20}],
		]);
	});

	it("links a markdown link to an existing file as a file-ref button and drops a dead link to an unknown one", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider value={{sessionId: "link-refs", cwd: "/repo", sessionPaths: [], open}}>
					<ProseMarkdown markdown="See [the app](src/app.ts#top) and [web](https://example.com/x.ts)." />
				</FileRefsProvider>,
			),
		);

		await waitFor(() => {
			expect(container.querySelectorAll("[data-file-ref]")).toHaveLength(1);
		});
		const ref = container.querySelector<HTMLElement>("[data-file-ref]")!;
		expect({
			text: ref.textContent,
			role: ref.getAttribute("role"),
			links: [...container.querySelectorAll("a")].map((link) => link.getAttribute("href")),
		}).toStrictEqual({text: "the app", role: "button", links: ["https://example.com/x.ts"]});

		fireEvent.click(ref);
		expect(open.mock.calls).toStrictEqual([[{path: "/repo/src/app.ts"}]]);
	});

	it("renders an outside-roots path as blocked code with its reason, shown in a tooltip on hover", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider value={{sessionId: "refs-test", cwd: "/repo", sessionPaths: [], open}}>
					<ProseMarkdown markdown="Notes are in `/tmp/outside/notes.txt`." />
				</FileRefsProvider>,
			),
		);

		const wrapper = await waitFor(() => {
			const found = container.querySelector<HTMLElement>("[data-disabled-reason-wrapper]");
			expect(found).not.toBeNull();
			return found!;
		});
		const reasonId = wrapper.getAttribute("aria-describedby")!;
		expect({
			html: wrapper.outerHTML,
			refs: container.querySelectorAll("[data-file-ref]").length,
		}).toStrictEqual({
			html: `<span tabindex="0" data-disabled-reason-wrapper="" aria-describedby="${reasonId}" class="inline rounded-sm focus-visible:outline-hidden focus-visible:shadow-focus"><code data-inline-code="" data-file-ref-blocked="">/tmp/outside/notes.txt</code><span id="${reasonId}" hidden="" data-disabled-reason="">${OUTSIDE_REASON}</span></span>`,
			refs: 0,
		});

		fireEvent.click(wrapper);
		fireEvent.pointerOver(wrapper.querySelector("code")!);
		const tooltip = await screen.findByRole("tooltip");
		expect({
			text: tooltip.textContent,
			side: tooltip.getAttribute("data-side"),
			opened: open.mock.calls,
		}).toStrictEqual({text: OUTSIDE_REASON, side: "top", opened: []});
		fireEvent.pointerOut(wrapper, {relatedTarget: document.body});
		expect(screen.queryByRole("tooltip")).toBeNull();

		act(() => {
			wrapper.focus();
		});
		expect(screen.getByRole("tooltip").textContent).toBe(OUTSIDE_REASON);
		act(() => {
			wrapper.blur();
		});
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("links a missing path optimistically, and on click shows busy past 150ms, then the blocked missing state with focus kept", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider value={{sessionId: "missing-slow", cwd: "/repo", sessionPaths: [], open}}>
					<ProseMarkdown markdown="Create `src/new.ts:3` next." />
				</FileRefsProvider>,
			),
		);
		const link = await waitFor(() => {
			const found = container.querySelector<HTMLElement>("[data-file-ref]");
			expect(found).not.toBeNull();
			return found!;
		});
		expect(link.outerHTML).toBe(
			`<span role="button" tabindex="0" class="prose-link" data-file-ref="" data-file-path="/repo/src/new.ts" data-file-line="3"><span data-inline-code="">src/new.ts:3</span></span>`,
		);

		vi.useFakeTimers();
		statDelayMs = 200;
		link.focus();
		fireEvent.click(link);
		await act(async () => vi.advanceTimersByTimeAsync(160));
		expect(link.getAttribute("aria-busy")).toBe("true");
		await act(async () => vi.advanceTimersByTimeAsync(100));

		const wrapper = container.querySelector<HTMLElement>("[data-disabled-reason-wrapper]");
		expect({
			refs: container.querySelectorAll("[data-file-ref]").length,
			code: wrapper?.querySelector("code")?.textContent,
			reason: wrapper?.querySelector("[data-disabled-reason]")?.textContent,
			focused: document.activeElement === wrapper,
			opened: open.mock.calls,
		}).toStrictEqual({refs: 0, code: "src/new.ts:3", reason: MISSING_REASON, focused: true, opened: []});
	});

	it("never shows busy when the missing check settles within 150ms", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider value={{sessionId: "missing-fast", cwd: "/repo", sessionPaths: [], open}}>
					<ProseMarkdown markdown="Create `src/new.ts` next." />
				</FileRefsProvider>,
			),
		);
		const link = await waitFor(() => {
			const found = container.querySelector<HTMLElement>("[data-file-ref]");
			expect(found).not.toBeNull();
			return found!;
		});

		vi.useFakeTimers();
		statDelayMs = 50;
		const busy: (string | null)[] = [];
		const observer = new MutationObserver(() => busy.push(link.getAttribute("aria-busy")));
		observer.observe(link, {attributes: true, attributeFilter: ["aria-busy"]});
		fireEvent.click(link);
		await act(async () => vi.advanceTimersByTimeAsync(300));
		observer.disconnect();

		expect({
			busy,
			blocked: container.querySelector("[data-disabled-reason-wrapper] [data-disabled-reason]")?.textContent,
			opened: open.mock.calls,
		}).toStrictEqual({busy: [], blocked: MISSING_REASON, opened: []});
	});

	it("opens an existing file at once, with no busy state or recheck", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider value={{sessionId: "exists-now", cwd: "/repo", sessionPaths: [], open}}>
					<ProseMarkdown markdown="See `src/app.ts`." />
				</FileRefsProvider>,
			),
		);
		const link = await waitFor(() => {
			const found = container.querySelector<HTMLElement>("[data-file-ref]");
			expect(found).not.toBeNull();
			return found!;
		});
		const requestsBefore = statRequests.length;
		fireEvent.click(link);
		expect({
			opened: open.mock.calls,
			busy: link.getAttribute("aria-busy"),
			rechecks: statRequests.length - requestsBefore,
		}).toStrictEqual({opened: [[{path: "/repo/src/app.ts"}]], busy: null, rechecks: 0});
	});

	it("⌘- or Ctrl-click opens a ref inside the cwd with its default app, not the Files pane", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider value={{sessionId: "exists-now", cwd: "/repo", sessionPaths: [], open}}>
					<ProseMarkdown markdown="See `src/app.ts`." />
					<TruncatedFilePathHeader filePath="/repo/.mise/config.toml" />
				</FileRefsProvider>,
			),
		);
		const prose = await waitFor(() => {
			const found = container.querySelector<HTMLElement>(".prose-link[data-file-ref]");
			expect(found).not.toBeNull();
			return found!;
		});
		fireEvent.click(prose, {metaKey: true});
		fireEvent.click(await screen.findByRole("button", {name: "/repo/.mise/config.toml"}), {ctrlKey: true});
		const openFileBodies = () =>
			vi
				.mocked(fetch)
				.mock.calls.filter(([url]) => String(url) === "/api/open-file")
				.map(([, init]) => JSON.parse(String(init?.body)) as unknown);
		await waitFor(() => {
			expect(openFileBodies()).toHaveLength(2);
		});

		expect({opened: openFileBodies(), paneOpens: open.mock.calls}).toStrictEqual({
			opened: [{path: "/repo/src/app.ts"}, {path: "/repo/.mise/config.toml"}],
			paneOpens: [],
		});
	});

	it("⌘-click on a ref outside the cwd opens it in the Files pane as a plain click does", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		render(
			withQueryClient(
				<FileRefsProvider value={{sessionId: "refs-test", cwd: "/repo/src", sessionPaths: [], open}}>
					<TruncatedFilePathHeader filePath="/repo/.mise/config.toml" />
				</FileRefsProvider>,
			),
		);
		fireEvent.click(await screen.findByRole("button", {name: "/repo/.mise/config.toml"}), {metaKey: true});

		expect({
			paneOpens: open.mock.calls,
			openFileCalls: vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/open-file").length,
		}).toStrictEqual({paneOpens: [[{path: "/repo/.mise/config.toml"}]], openFileCalls: 0});
	});

	it("renders plain markdown outside a file-refs provider", () => {
		const {container} = render(withQueryClient(<ProseMarkdown markdown={MESSAGE} />));
		expect({
			refs: container.querySelectorAll("[data-file-ref]").length,
			fetches: statRequests.length,
		}).toStrictEqual({refs: 0, fetches: 0});
	});
});

describe("TruncatedFilePathHeader file refs", () => {
	it("becomes clickable once the path is confirmed, and dispatches open", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		render(
			withQueryClient(
				<FileRefsProvider value={{sessionId: "refs-test", cwd: "/repo", sessionPaths: [], open}}>
					<TruncatedFilePathHeader filePath="/repo/src/app.ts" />
					<TruncatedFilePathHeader filePath="/repo/deleted.ts" />
					<TruncatedFilePathHeader filePath="/tmp/outside/notes.txt" />
				</FileRefsProvider>,
			),
		);

		const button = await screen.findByRole("button", {name: "/repo/src/app.ts"});
		fireEvent.click(button);
		expect({
			calls: open.mock.calls,
			deletedIsButton: screen.queryByRole("button", {name: "/repo/deleted.ts"}) !== null,
			outsideIsButton: screen.queryByRole("button", {name: "/tmp/outside/notes.txt"}) !== null,
		}).toStrictEqual({calls: [[{path: "/repo/src/app.ts"}]], deletedIsButton: false, outsideIsButton: false});
	});
});

describe("SessionFileRefs", () => {
	let unregister: () => void = () => {};

	afterEach(() => {
		unregister();
	});

	it("clicking a transcript ref opens the closed Files pane with a preview tab", async () => {
		unregister = registerPane("files", {
			title: "Files",
			header: "custom",
			render: (chrome) => (
				<FilesPaneView
					chrome={chrome}
					sessionId="refs-session"
					cwd="/repo"
					sessionFiles={EMPTY_SESSION_FILES}
					unscannedRecordCount={0}
				/>
			),
		});
		const {container} = render(
			withQueryClient(
				<SettingsProvider>
					<ToastProvider>
						<TileHost sessionId="refs-session">
							<SessionFileRefs sessionId="refs-session" cwd="/repo" sessionFiles={EMPTY_SESSION_FILES}>
								<ProseMarkdown markdown={MESSAGE} />
							</SessionFileRefs>
						</TileHost>
					</ToastProvider>
				</SettingsProvider>,
			),
		);

		await waitFor(() => {
			expect(container.querySelectorAll("[data-file-ref]")).toHaveLength(2);
		});
		expect(screen.queryByRole("region", {name: "Files"})).toBeNull();
		act(() => {
			container.querySelector<HTMLElement>("[data-file-ref]")!.click();
		});

		const tab = await screen.findByRole("tab", {name: /config\.toml/});
		expect({
			paneOpen: screen.queryByRole("region", {name: "Files"}) !== null,
			selected: tab.getAttribute("aria-selected"),
			preview: tab.className.includes("italic"),
		}).toStrictEqual({paneOpen: true, selected: "true", preview: true});
	});
});
