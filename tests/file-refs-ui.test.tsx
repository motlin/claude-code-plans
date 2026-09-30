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

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = String(input);
	if (url === "/api/file-refs") {
		const {paths} = JSON.parse(String(init?.body)) as {paths: string[]};
		statRequests.push(paths);
		return Promise.resolve(Response.json({existing: paths.filter((path) => EXISTING.includes(path))}));
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
	vi.stubGlobal("fetch", vi.fn(fakeFetch));
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
	);
});

afterEach(() => {
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
				<FileRefsProvider value={{cwd: "/repo", sessionPaths: [], open}}>
					<ProseMarkdown markdown={MESSAGE} />
				</FileRefsProvider>,
			),
		);

		await waitFor(() => expect(container.querySelectorAll("[data-file-ref]")).toHaveLength(2));
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
				<FileRefsProvider value={{cwd: "/repo", sessionPaths: [], open}}>
					<TruncatedFilePathHeader filePath="/repo/src/app.ts" />
					<TruncatedFilePathHeader filePath="/repo/deleted.ts" />
				</FileRefsProvider>,
			),
		);

		const button = await screen.findByRole("button", {name: "/repo/src/app.ts"});
		fireEvent.click(button);
		expect({
			calls: open.mock.calls,
			deletedIsButton: screen.queryByRole("button", {name: "/repo/deleted.ts"}) !== null,
		}).toStrictEqual({calls: [[{path: "/repo/src/app.ts"}]], deletedIsButton: false});
	});
});

describe("SessionFileRefs", () => {
	let unregister: () => void = () => {};

	afterEach(() => unregister());

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

		await waitFor(() => expect(container.querySelectorAll("[data-file-ref]")).toHaveLength(2));
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
