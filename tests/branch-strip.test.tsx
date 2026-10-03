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

const EXAMPLE_PR = {
	number: 100,
	url: "https://github.com/alice/example-repo/pull/100",
	repository: "alice/example-repo",
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
	it.each([
		{...SESSION, pr: EXAMPLE_PR},
		{...SESSION, prStatus: {number: 100, state: "open" as const}},
	])("exposes PR controls as a named native navigation landmark: %j", (session) => {
		const view = renderStrip(session);
		const landmark = view.getByRole("navigation", {name: "Repository and pull request controls"});
		expect({
			tag: landmark.tagName,
			label: landmark.getAttribute("aria-label"),
		}).toStrictEqual({tag: "NAV", label: "Repository and pull request controls"});
	});

	it("keeps ordinary branch controls in an unlabeled div without a navigation landmark", () => {
		const view = renderStrip();
		expect({
			navigation: view.queryAllByRole("navigation"),
			tag: strip(view)?.tagName,
			label: strip(view)?.getAttribute("aria-label"),
		}).toStrictEqual({navigation: [], tag: "DIV", label: null});
	});

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

	it.each([
		{state: "open" as const, label: "Open"},
		{state: "draft" as const, label: "Draft"},
		{state: "merged" as const, label: "Merged"},
		{state: "closed" as const, label: "Closed"},
	])("shows the known $state PR without misrepresenting session branch or edit totals", ({state, label}) => {
		const view = renderStrip(
			{
				...SESSION,
				gitBranch: "main",
				pr: EXAMPLE_PR,
				prStatus: {number: EXAMPLE_PR.number, url: EXAMPLE_PR.url, state},
			},
			"session-alice",
			STATUSLINE,
		);
		const link = view.getByRole("link", {name: "#100"});
		expect({
			href: link.getAttribute("href"),
			repo: view.getByRole("button", {name: "Repository alice/example-repo"}).getAttribute("title"),
			state: view.getByText(label).textContent,
			branch: view.container.querySelector("[data-branch-name]"),
			changes: view.queryByRole("button", {name: "3,093 additions, 1 deletion"}),
		}).toStrictEqual({
			href: EXAMPLE_PR.url,
			repo: EXAMPLE_PR.repository,
			state: label,
			branch: null,
			changes: null,
		});
	});

	it.each([
		undefined,
		{number: 200, state: "merged" as const, url: EXAMPLE_PR.url},
		{number: 100, state: "merged" as const, url: "https://github.com/bob/other-repo/pull/100"},
		{number: 100, state: "merged" as const},
	])("does not apply unproven status to the linked PR: %j", (prStatus) => {
		const view = renderStrip({...SESSION, pr: EXAMPLE_PR, ...(prStatus === undefined ? {} : {prStatus})});
		expect({
			href: view.getByRole("link", {name: "#100"}).getAttribute("href"),
			state: view.getByText("Status unknown").textContent,
		}).toStrictEqual({href: EXAMPLE_PR.url, state: "Status unknown"});
	});

	it("shows a status-only PR without fabricating a link or repository", () => {
		const view = renderStrip({...SESSION, prStatus: {number: 100, state: "merged"}}, "session-alice", STATUSLINE);
		expect({
			number: view.getByText("#100").textContent,
			state: view.getByText("Merged").textContent,
			links: view.queryAllByRole("link"),
			project: view.queryByRole("button", {name: SESSION.projectName}),
			branch: view.container.querySelector("[data-branch-name]"),
		}).toStrictEqual({number: "#100", state: "Merged", links: [], project: null, branch: null});
	});
});

describe("branchStripVisible", () => {
	const PR = EXAMPLE_PR;
	const COMMITTED = {additions: 178, deletions: 34};
	const status = (state: "open" | "draft" | "merged" | "closed") => ({number: 100, state, url: PR.url});

	it.each([
		["no PR, uncommitted changes (upstream: strip with Create PR)", {gitBranch: "b"}, COMMITTED, true],
		["no PR, branch only", {gitBranch: "b"}, null, true],
		["no PR, line counts without a branch", {gitBranch: null}, COMMITTED, true],
		["no PR, no branch, no line counts", {gitBranch: null}, null, false],
		["open PR, committed changes", {gitBranch: "b", pr: PR, prStatus: status("open")}, COMMITTED, true],
		["pr-link without a known state", {gitBranch: "b", pr: PR}, COMMITTED, true],
		["draft PR", {gitBranch: "b", pr: PR, prStatus: status("draft")}, COMMITTED, true],
		["merged PR", {gitBranch: "b", pr: PR, prStatus: status("merged")}, null, true],
		["PR status from gh without a pr-link", {gitBranch: "b", prStatus: status("open")}, COMMITTED, true],
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
it.each(["", "   ", "alice/", "alice/   "])("omits an empty remote repository caption: %j", (repository) => {
	const view = renderStrip({...SESSION, pr: {...EXAMPLE_PR, repository}});
	expect({
		number: view.getByRole("link", {name: "#100"}).getAttribute("href"),
		repositoryButtons: view
			.queryAllByRole("button")
			.filter((button) => button.getAttribute("title") === repository),
	}).toStrictEqual({number: EXAMPLE_PR.url, repositoryButtons: []});
});

it.each([undefined, EXAMPLE_PR.url])("shows status-only identity with its optional URL: %s", (url) => {
	const view = renderStrip({
		...SESSION,
		prStatus: {number: 100, state: "closed", ...(url === undefined ? {} : {url})},
	});
	expect({
		label: view.getByText("#100").textContent,
		href: view.queryByRole("link", {name: "#100"})?.getAttribute("href"),
		state: view.getByText("Closed").textContent,
		repository: view.queryByRole("button", {name: SESSION.projectName}),
	}).toStrictEqual({label: "#100", href: url, state: "Closed", repository: null});
});

it("retains the full long repository title", () => {
	const repository = "alice/example-repository-with-a-deliberately-long-fabricated-name";
	const view = renderStrip({...SESSION, pr: {...EXAMPLE_PR, repository}});
	expect(view.getByRole("button", {name: `Repository ${repository}`}).getAttribute("title")).toBe(repository);
});

it("dismisses a PR only for its session UUID", () => {
	const session = {...SESSION, pr: EXAMPLE_PR};
	const view = renderStrip(session, "session-alice");
	fireEvent.click(view.getByRole("button", {name: "Dismiss"}));
	expect({strip: strip(view), saved: sessionStorage.getItem("branch-strip-dismissed:session-alice")}).toStrictEqual({
		strip: null,
		saved: "1",
	});
	cleanup();
	expect(strip(renderStrip(session, "session-alice"))).toBeNull();
	cleanup();
	expect(renderStrip(session, "session-bob").getByRole("link", {name: "#100"}).getAttribute("href")).toBe(
		EXAMPLE_PR.url,
	);
});

it.each([300, 320, 321])("keeps the PR width threshold at %spx", (width) => {
	stripWidth = width;
	const view = renderStrip({...SESSION, gitBranch: null, pr: EXAMPLE_PR}, "session-alice", null);
	expect(view.queryByRole("link", {name: "#100"})?.getAttribute("href")).toBe(
		width <= 320 ? undefined : EXAMPLE_PR.url,
	);
});
