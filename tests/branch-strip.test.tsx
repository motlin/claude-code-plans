// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, type RenderResult, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {BranchStrip, type BranchStripSession, branchStripVisible, middleTruncate} from "../src/components/branch-strip";
import {ToastProvider} from "../src/components/toast";

let stripWidth = 800;

/** Reports `stripWidth` as the strip container's width as soon as it is observed. */
class WidthObserver {
	constructor(private readonly callback: ResizeObserverCallback) {}
	observe(target: Element) {
		this.callback(
			[{target, contentRect: {width: stripWidth}} as unknown as ResizeObserverEntry],
			this as unknown as ResizeObserver,
		);
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

const SESSION: BranchStripSession = {
	projectName: "claude-code-plans",
	projectPath: "/work/claude-code-plans",
	cwd: "/work/claude-code-plans",
	gitBranch: "feature/branch-strip",
};

const STATUSLINE = {cost: {total_lines_added: 3093, total_lines_removed: 1}};

function renderStrip(
	session: BranchStripSession = SESSION,
	sessionId = "session-1",
	statusline: Record<string, unknown> | null = STATUSLINE,
): RenderResult {
	return render(
		<ToastProvider>
			<BranchStrip sessionId={sessionId} session={session} statusline={statusline} />
		</ToastProvider>,
	);
}

function strip(view: RenderResult): Element | null {
	return view.container.querySelector("[data-branch-strip]");
}

beforeEach(() => {
	stripWidth = 800;
	globalThis.ResizeObserver = WidthObserver as unknown as typeof ResizeObserver;
	sessionStorage.clear();
});

afterEach(() => {
	cleanup();
});

describe("BranchStrip", () => {
	it("shows the statusline line counts with an sr-only description", () => {
		const view = renderStrip();
		const button = view.getByRole("button", {name: "3,093 additions, 1 deletion"});
		expect({
			visible: button.querySelector("[aria-hidden]")?.textContent,
			sr: button.querySelector(".sr-only")?.textContent,
		}).toStrictEqual({visible: "+3,093 −1", sr: "3,093 additions, 1 deletion"});
	});

	it("shows the project and the full branch name", () => {
		const view = renderStrip();
		expect({
			project: view.getByRole("button", {name: "claude-code-plans"}).textContent,
			branch: view.container.querySelector("[data-branch-name]")?.getAttribute("title"),
		}).toStrictEqual({project: "claude-code-plans", branch: "feature/branch-strip"});
	});

	it("stays dismissed for that session only", () => {
		const first = renderStrip();
		fireEvent.click(first.getByRole("button", {name: "Dismiss"}));
		expect(strip(first)).toBeNull();
		cleanup();

		expect(strip(renderStrip())).toBeNull();
		cleanup();

		expect(strip(renderStrip(SESSION, "session-2"))).not.toBeNull();
	});

	it("hides at a container width of 320px or less", () => {
		stripWidth = 320;
		expect(strip(renderStrip())).toBeNull();
		cleanup();

		stripWidth = 321;
		expect(strip(renderStrip())).not.toBeNull();
	});

	it("renders nothing without a branch or line counts", () => {
		const view = renderStrip({...SESSION, gitBranch: null}, "session-1", null);
		expect(strip(view)).toBeNull();
	});

	it("renders nothing once the session has an open PR, as upstream's dock does for session 7e8c9305", () => {
		const view = renderStrip(
			{
				projectName: "eclipse-collections",
				projectPath: "/work/eclipse-collections",
				cwd: "/work/eclipse-collections",
				gitBranch: "OrderedHashMap",
				pr: {
					number: 1954,
					url: "https://github.com/eclipse-collections/eclipse-collections/pull/1954",
					repository: "eclipse-collections/eclipse-collections",
				},
				prStatus: {
					number: 1954,
					state: "open",
					url: "https://github.com/eclipse-collections/eclipse-collections/pull/1954",
				},
			},
			"7e8c9305-b260-43d0-b551-61e69ac86890",
			{cost: {total_lines_added: 178, total_lines_removed: 34}},
		);
		expect({strip: strip(view), dismiss: view.queryByRole("button", {name: "Dismiss"})}).toStrictEqual({
			strip: null,
			dismiss: null,
		});
	});
});

describe("branchStripVisible", () => {
	const PR = {number: 1954, url: "https://github.com/o/r/pull/1954", repository: "o/r"};
	const COMMITTED = {additions: 178, deletions: 34};
	const status = (state: "open" | "draft" | "merged" | "closed") => ({number: 1954, state, url: PR.url});

	it.each([
		["no PR, uncommitted changes (upstream: strip with Create PR)", {gitBranch: "b"}, COMMITTED, true],
		["no PR, branch only", {gitBranch: "b"}, null, true],
		["no PR, line counts without a branch", {gitBranch: null}, COMMITTED, true],
		["no PR, no branch, no line counts", {gitBranch: null}, null, false],
		[
			"open PR, committed changes (session 7e8c9305)",
			{gitBranch: "b", pr: PR, prStatus: status("open")},
			COMMITTED,
			false,
		],
		["pr-link without a known state", {gitBranch: "b", pr: PR}, COMMITTED, false],
		["draft PR", {gitBranch: "b", pr: PR, prStatus: status("draft")}, COMMITTED, false],
		["merged PR", {gitBranch: "b", pr: PR, prStatus: status("merged")}, null, false],
		["PR status from gh without a pr-link", {gitBranch: "b", prStatus: status("open")}, COMMITTED, false],
	] as const)("%s", (_state, fields, counts, expected) => {
		expect(branchStripVisible({...SESSION, ...fields}, counts)).toBe(expected);
	});
});

describe("middleTruncate", () => {
	it("keeps short names whole", () => {
		expect(middleTruncate("main", 10)).toBe("main");
	});

	it("keeps the start and end of long names", () => {
		expect(middleTruncate("feature/abcdefghijklmnop-end", 12)).toBe("featur…p-end");
	});
});

describe("BranchStrip project menu", () => {
	const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
	const writeText = vi.fn<(text: string) => Promise<void>>();
	const openMock = vi.fn<typeof window.open>();
	async function flush() {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}

	async function openProjectMenu(): Promise<string[]> {
		fireEvent.click(screen.getByRole("button", {name: "claude-code-plans"}));
		await flush();
		return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
	}

	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("open", openMock);
		fetchMock.mockReset();
		fetchMock.mockImplementation(async () => Response.json({ok: true}));
		writeText.mockReset();
		writeText.mockResolvedValue(undefined);
		openMock.mockReset();
		openMock.mockReturnValue(null);
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("offers Finder, path and branch", async () => {
		renderStrip();

		expect(await openProjectMenu()).toStrictEqual(["Open in Finder", "Copy path", "Copy branch name"]);
	});

	it("drops the branch item when the session has no branch", async () => {
		renderStrip({...SESSION, gitBranch: null});

		expect(await openProjectMenu()).toStrictEqual(["Open in Finder", "Copy path"]);
	});

	it("wires each item to its action", async () => {
		renderStrip();

		for (const item of ["Copy path", "Copy branch name", "Open in Finder"]) {
			await openProjectMenu();
			fireEvent.click(screen.getByRole("menuitem", {name: item}));
			await flush();
		}

		expect({
			clipboard: writeText.mock.calls,
			opened: openMock.mock.calls,
			posts: fetchMock.mock.calls
				.filter(([, init]) => init?.method === "POST")
				.map(([input, init]) => [typeof input === "string" ? input : "", init?.body]),
		}).toStrictEqual({
			clipboard: [["/work/claude-code-plans"], ["feature/branch-strip"]],
			opened: [],
			posts: [["/api/open-in-finder", JSON.stringify({sessionId: "session-1"})]],
		});
	});
});
