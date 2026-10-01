// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, type RenderResult, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {BranchStrip, type BranchStripSession, middleTruncate} from "../src/components/branch-strip";
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

	it("omits the PR chip without a pr-link", () => {
		const view = renderStrip();
		expect(view.container.querySelector("[data-pr-chip]")).toBeNull();
	});

	it("links the PR chip to the pr-link url", () => {
		const view = renderStrip({
			...SESSION,
			pr: {number: 42, url: "https://github.com/o/r/pull/42", repository: "o/r"},
		});
		const chip = view.container.querySelector("[data-pr-chip]");
		expect({text: chip?.textContent, href: chip?.getAttribute("href")}).toStrictEqual({
			text: "#42",
			href: "https://github.com/o/r/pull/42",
		});
	});

	it("colors the PR chip by the known PR state", () => {
		const view = renderStrip({
			...SESSION,
			pr: {number: 42, url: "https://github.com/o/r/pull/42", repository: "o/r"},
			prStatus: {number: 42, state: "merged", url: "https://github.com/o/r/pull/42"},
		});
		expect(view.container.querySelector("[data-pr-chip]")?.getAttribute("data-pr-state")).toBe("merged");
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

	it("renders nothing without a branch, line counts or PR", () => {
		const view = renderStrip({...SESSION, gitBranch: null}, "session-1", null);
		expect(strip(view)).toBeNull();
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
	const withRepository: BranchStripSession = {
		...SESSION,
		pr: {number: 42, url: "https://github.com/o/r/pull/42", repository: "o/r"},
	};

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

	it("offers Finder, path, branch and the GitHub repository when known", async () => {
		renderStrip(withRepository);

		expect(await openProjectMenu()).toStrictEqual([
			"Open in Finder",
			"Copy path",
			"Copy branch name",
			"Open repository on GitHub",
		]);
	});

	it("drops branch and repository items when the session has neither", async () => {
		renderStrip({...SESSION, gitBranch: null});

		expect(await openProjectMenu()).toStrictEqual(["Open in Finder", "Copy path"]);
	});

	it("wires each item to its action", async () => {
		renderStrip(withRepository);

		for (const item of ["Copy path", "Copy branch name", "Open repository on GitHub", "Open in Finder"]) {
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
			opened: [["https://github.com/o/r", "_blank", "noopener,noreferrer"]],
			posts: [["/api/open-in-finder", JSON.stringify({sessionId: "session-1"})]],
		});
	});
});
