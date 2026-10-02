// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {useRegisterChangesPane} from "../src/components/changes/changes-pane-entry";
import {TileHost, usePaneHost} from "../src/components/panes/tile-host";
import {DEFAULTS, SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {sessionDiffQueryOptions, sessionDiffScopesQueryOptions} from "../src/lib/api/session-diff";
import {defaultPaneLayout, loadPaneLayout, openPane, savePaneLayout, type PaneKind} from "../src/lib/pane-layout";
import {installLocalStorage} from "./fake-storage";

const harness = vi.hoisted(() => {
	let finish!: () => void;
	const ready = new Promise<void>((resolve) => {
		finish = resolve;
	});
	return {ready, finish, fail: true, imports: 0};
});

vi.mock("../src/components/changes/changes-pane", async (importOriginal) => {
	harness.imports++;
	await harness.ready;
	const actual = await importOriginal<typeof import("../src/components/changes/changes-pane")>();
	return {
		...actual,
		get ChangesPane() {
			if (harness.fail) throw new Error("Example changes chunk unavailable");
			return actual.ChangesPane;
		},
	};
});

const LOADED_STATE = {
	buttons: ["Diff scope: Session edits", "Move", "Changes settings", "Expand", "Close"],
	error: null,
	loading: null,
};
const SESSION = "session-alice";
let queryClient: QueryClient;

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

function OpenChanges() {
	const host = usePaneHost();
	return (
		<button type="button" onClick={() => host.openPane("changes")}>
			Open changes
		</button>
	);
}

function App({requested}: {requested?: PaneKind}) {
	useRegisterChangesPane(SESSION);
	const [requestedPane, setRequestedPane] = useState(requested);
	return (
		<TileHost
			sessionId={SESSION}
			onExpandWithoutPane={() => {}}
			requestedPane={requestedPane}
			onRequestedPaneHandled={() => setRequestedPane(undefined)}
		>
			<OpenChanges />
		</TileHost>
	);
}

function renderApp(requested?: PaneKind) {
	return render(
		<QueryClientProvider client={queryClient}>
			<SettingsProvider>
				<ToastProvider>
					<App {...(requested === undefined ? {} : {requested})} />
				</ToastProvider>
			</SettingsProvider>
		</QueryClientProvider>,
	);
}

function paneState() {
	const pane = screen.getByRole("region", {name: "Changes"});
	return {
		loading: within(pane).queryByRole("status")?.textContent ?? null,
		error: within(pane).queryByRole("alert")?.textContent ?? null,
		buttons: within(pane)
			.getAllByRole("button")
			.map((button) => button.getAttribute("aria-label") ?? button.textContent),
	};
}

beforeEach(() => {
	installLocalStorage();
	queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(
		sessionDiffQueryOptions(SESSION, "branch", {hideWhitespace: DEFAULTS.diffHideWhitespace}).queryKey,
		{scope: "branch", source: "git", stats: {files: 0, additions: 0, deletions: 0}, files: []},
	);
	queryClient.setQueryData(sessionDiffScopesQueryOptions(SESSION).queryKey, {kind: "no-git"});
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({width: 1200, height: 800}),
	);
});

afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("deferred Changes renderer", () => {
	it("loads only when opened, keeps controls on load failure, retries, and reopens the actual pane without a fallback", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		renderApp();
		const closed = {imports: harness.imports, pane: screen.queryByRole("region", {name: "Changes"})};
		cleanup();
		savePaneLayout(SESSION, openPane(defaultPaneLayout(), "changes"));
		renderApp();
		const loading = paneState();
		const coldSaved = loadPaneLayout(SESSION);
		await act(async () => harness.finish());
		await within(screen.getByRole("region", {name: "Changes"})).findByRole("alert");
		const failed = paneState();
		harness.fail = false;
		fireEvent.click(screen.getByRole("button", {name: "Retry"}));
		await screen.findByText("No changes to show");
		const loaded = paneState();
		fireEvent.click(screen.getByRole("button", {name: "Close"}));
		fireEvent.click(screen.getByRole("button", {name: "Open changes"}));
		expect({
			closed,
			coldSaved,
			loading,
			failed,
			loaded,
			reopened: paneState(),
			body: screen.getByText("No changes to show").textContent,
			imports: harness.imports,
		}).toStrictEqual({
			closed: {imports: 0, pane: null},
			coldSaved: {
				expanded: null,
				focused: "changes",
				root: {
					kind: "stack",
					direction: "row",
					flex: 1,
					children: [
						{kind: "tile", tileId: "chat", flex: 1},
						{kind: "tile", tileId: "changes", flex: 0.25},
					],
				},
			},
			loading: {buttons: ["Move", "Expand", "Close"], error: null, loading: "Loading changes…"},
			failed: {buttons: ["Move", "Expand", "Close", "Retry"], error: "Couldn't load Changes.", loading: null},
			loaded: LOADED_STATE,
			reopened: LOADED_STATE,
			body: "No changes to show",
			imports: 1,
		});

		// Exercise restored and requested entry points with the same successfully loaded module.
		for (const entry of ["saved", "requested"] as const) {
			cleanup();
			installLocalStorage();
			if (entry === "saved") savePaneLayout(SESSION, openPane(defaultPaneLayout(), "changes"));
			renderApp(entry === "requested" ? "changes" : undefined);
			await screen.findByText("No changes to show");
			const loaded = paneState();
			const saved = loadPaneLayout(SESSION);
			fireEvent.click(screen.getByRole("button", {name: "Close"}));
			expect({
				loaded,
				saved,
				closed: screen.queryByRole("region", {name: "Changes"}),
				savedAfterClose: loadPaneLayout(SESSION),
			}).toStrictEqual({
				loaded: LOADED_STATE,
				saved: {
					expanded: null,
					focused: "changes",
					root: {
						kind: "stack",
						direction: "row",
						flex: 1,
						children: [
							{kind: "tile", tileId: "chat", flex: 1},
							{kind: "tile", tileId: "changes", flex: entry === "saved" ? 0.25 : 0.30837},
						],
					},
				},
				closed: null,
				savedAfterClose: {
					expanded: null,
					focused: "chat",
					root: {
						kind: "stack",
						direction: "row",
						flex: 1,
						children: [{kind: "tile", tileId: "chat", flex: 1}],
					},
				},
			});
		}
	});
});
