// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FileView} from "../src/components/files/file-view";
import {ToastProvider} from "../src/components/toast";
import {decodeFilePath, encodeFilePath} from "../src/lib/api/file";
import {writeClipboardText} from "../src/lib/clipboard";
import {formatFileSize} from "../src/lib/file-preview";

vi.mock("../src/lib/clipboard", () => ({
	writeClipboardText: vi.fn(async () => true),
}));

vi.mock("../src/hooks/use-shiki", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/hooks/use-shiki")>()),
	useHighlightedLines: () => null,
}));

type FakeResponse = {status: number; body: unknown};

let responses: Map<string, FakeResponse>;
let requests: string[];
let existingPaths: Set<string>;
const scrollIntoView = vi.fn();

function stubFetch(): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init?: RequestInit) => {
			if (input === "/api/file-refs") {
				const {paths} = JSON.parse(String(init?.body)) as {paths: string[]};
				return Response.json({existing: paths.filter((path) => existingPaths.has(path))});
			}
			const url = new URL(input, "http://localhost");
			const path = decodeFilePath(url.pathname.slice("/api/file/".length)) ?? "";
			const key = `${path}${url.search}`;
			requests.push(key);
			const response = responses.get(key) ?? {status: 404, body: {error: "File not found"}};
			return Response.json(response.body, {status: response.status});
		}),
	);
}

function renderView(props: Parameters<typeof FileView>[0]) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<FileView {...props} />
			</ToastProvider>
		</QueryClientProvider>,
	);
}

function highlightedLineIds(): string[] {
	return [...document.querySelectorAll('[data-highlighted="true"]')].map((element) => element.id);
}

function textFile(path: string, content: string): void {
	responses.set(path, {status: 200, body: {content, path}});
}

beforeEach(() => {
	responses = new Map();
	requests = [];
	existingPaths = new Set();
	stubFetch();
	window.history.replaceState(null, "", "/session/alice");
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: scrollIntoView,
	});
	scrollIntoView.mockReset();
	vi.mocked(writeClipboardText).mockClear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("markdown files", () => {
	const README = "/home/alice/notes/README.md";

	it("renders markdown by default and the toggle flips between source and preview", async () => {
		textFile(README, "# Alice notes\n\nSee [bob](bob.md).");
		renderView({path: README});

		await screen.findByRole("heading", {name: "Alice notes"});
		const renderedLabel = screen.getByRole("button", {name: "View source"}).getAttribute("aria-label");

		fireEvent.click(screen.getByRole("button", {name: "View source"}));

		expect({
			renderedLabel,
			toggledLabel: screen.getByRole("button", {name: "Preview"}).getAttribute("aria-label"),
			heading: screen.queryByRole("heading", {name: "Alice notes"}),
			firstSourceLine: document.querySelector("#L1 code")?.textContent,
		}).toStrictEqual({
			renderedLabel: "View source",
			toggledLabel: "Preview",
			heading: null,
			firstSourceLine: "# Alice notes",
		});
	});

	it("opens sibling markdown links through onOpenFile instead of navigating", async () => {
		textFile(README, "See [bob](bob.md) and [carol](./carol.md#intro).");
		const onOpenFile = vi.fn();
		renderView({path: README, onOpenFile});

		fireEvent.click(await screen.findByRole("link", {name: "bob"}));
		fireEvent.click(screen.getByRole("link", {name: "carol"}));

		expect({opened: onOpenFile.mock.calls, url: window.location.pathname}).toStrictEqual({
			opened: [["/home/alice/notes/bob.md"], ["/home/alice/notes/carol.md"]],
			url: "/session/alice",
		});
	});
	it("puts a Copy code button on each fenced block that copies the block text", async () => {
		textFile(README, "Run this:\n\n```sh\npnpm install\n```\n");
		renderView({path: README});

		// The highlighter can re-render the article, detaching an earlier button; click until one lands.
		await waitFor(() => {
			fireEvent.click(screen.getByRole("button", {name: "Copy code"}));
			expect(vi.mocked(writeClipboardText).mock.calls).toHaveLength(1);
		});

		expect({
			tooltip: screen.getByRole("button", {name: "Copy code"}).getAttribute("data-tooltip"),
			copied: vi.mocked(writeClipboardText).mock.calls,
		}).toStrictEqual({tooltip: "Copy code", copied: [["pnpm install\n"]]});
	});

	it("turns inline-code file paths into buttons that open the file, resolved against the file's directory, then the cwd", async () => {
		textFile(README, "See `src/lib/foo.ts`, `bob.md:3` and `missing.ts`.");
		existingPaths = new Set(["/home/alice/src/lib/foo.ts", "/home/alice/notes/bob.md", "/home/alice/bob.md"]);
		const onOpenFile = vi.fn();
		renderView({path: README, cwd: "/home/alice", onOpenFile});

		// The highlighter can re-render the article, detaching earlier buttons; retry until both land.
		await waitFor(() => {
			onOpenFile.mockClear();
			fireEvent.click(screen.getByRole("button", {name: "src/lib/foo.ts"}));
			fireEvent.keyDown(screen.getByRole("button", {name: "bob.md:3"}), {key: "Enter"});
			expect(onOpenFile.mock.calls).toHaveLength(2);
		});

		expect({
			opened: onOpenFile.mock.calls,
			missing: screen.queryByRole("button", {name: "missing.ts"}),
		}).toStrictEqual({
			opened: [["/home/alice/src/lib/foo.ts"], ["/home/alice/notes/bob.md"]],
			missing: null,
		});
	});

	it("leaves inline-code paths as plain code without onOpenFile", async () => {
		textFile(README, "See `src/lib/foo.ts`.");
		existingPaths = new Set(["/home/alice/src/lib/foo.ts"]);
		renderView({path: README, cwd: "/home/alice"});

		await screen.findByText("src/lib/foo.ts");
		expect(screen.queryByRole("button", {name: "src/lib/foo.ts"})).toBeNull();
	});
});

describe("breadcrumb", () => {
	it("copies the path shown relative to cwd and confirms with a toast", async () => {
		textFile("/home/alice/project/src/agent.ts", "export const agent = 1;");
		renderView({path: "/home/alice/project/src/agent.ts", cwd: "/home/alice/project"});

		const button = screen.getByRole("button", {name: "Copy path src/agent.ts"});
		await act(async () => {
			fireEvent.click(button);
		});

		expect({
			copied: vi.mocked(writeClipboardText).mock.calls,
			toast: (await screen.findByText("Path copied to clipboard.")).textContent,
			segments: [...button.querySelectorAll("[data-breadcrumb-segment]")].map((segment) => segment.textContent),
		}).toStrictEqual({
			copied: [["src/agent.ts"]],
			toast: "Path copied to clipboard.",
			segments: ["src", "agent.ts"],
		});
	});
	it("titles each segment with its cumulative path", () => {
		textFile("/home/alice/project/.llm/plan.md", "# Plan");
		renderView({path: "/home/alice/project/.llm/plan.md", cwd: "/home/alice/project"});

		const button = screen.getByRole("button", {name: "Copy path .llm/plan.md"});
		expect({
			titles: [...button.querySelectorAll("[data-breadcrumb-segment]")].map((segment) =>
				segment.getAttribute("title"),
			),
			buttonTitle: button.getAttribute("title"),
		}).toStrictEqual({titles: [".llm", ".llm/plan.md"], buttonTitle: null});
	});
});

describe("images", () => {
	it("streams images from the file API without fetching them as text", () => {
		renderView({path: "/home/alice/pictures/bg.png"});

		const image = screen.getByRole("img", {name: "bg.png"});
		expect({
			src: image.getAttribute("src"),
			requests,
			toggle: screen.queryByRole("button", {name: "View source"}),
		}).toStrictEqual({
			src: `/api/file/${encodeFilePath("/home/alice/pictures/bg.png")}`,
			requests: [],
			toggle: null,
		});
	});
});

describe("non-previewable files", () => {
	it("offers View as text anyway for binary files and refetches with force=text", async () => {
		const path = "/home/alice/data/alice.bin";
		responses.set(path, {
			status: 415,
			body: {error: "Binary files are not supported", kind: "binary", size: 3, type: "BIN file"},
		});
		textFile(`${path}?force=text`, "A\u0000B");
		renderView({path});

		const message = await screen.findByText("This file looks like binary data and can’t be previewed as text.");
		const messageText = message.textContent;
		fireEvent.click(screen.getByRole("button", {name: "View as text anyway"}));
		await waitFor(() => expect(document.querySelector("#L1 code")?.textContent).toBe("A\u0000B"));

		expect({messageText, requests}).toStrictEqual({
			messageText: "This file looks like binary data and can’t be previewed as text.",
			requests: [path, `${path}?force=text`],
		});
	});

	it("describes too-large files with type and size and offers a download", async () => {
		const path = "/home/alice/logs/huge.txt";
		responses.set(path, {
			status: 413,
			body: {
				error: "File exceeds the 5 MiB size limit",
				kind: "too-large",
				size: 6 * 1024 * 1024,
				type: "TXT file",
			},
		});
		renderView({path});

		const summary = await screen.findByText("TXT file · 6.0 MB");
		expect({
			summary: summary.textContent,
			detail: screen.getByText("It’s too large to preview here.").textContent,
			download: screen.getByRole("link", {name: "Download"}).getAttribute("href"),
		}).toStrictEqual({
			summary: "TXT file · 6.0 MB",
			detail: "It’s too large to preview here.",
			download: `/api/file/${encodeFilePath(path)}?download=1`,
		});
	});

	it("formats sizes like the upstream summary line", () => {
		expect([0, 512, 1536, 6 * 1024 * 1024, 3 * 1024 ** 3].map(formatFileSize)).toStrictEqual([
			"0 B",
			"512 B",
			"1.5 KB",
			"6.0 MB",
			"3.0 GB",
		]);
	});
});

describe("source view", () => {
	const SOURCE = "/home/alice/project/agent.ts";

	it("scrolls to and highlights the line..endLine range from props", async () => {
		textFile(SOURCE, Array.from({length: 10}, (_, index) => `line ${index + 1}`).join("\n"));
		renderView({path: SOURCE, line: 3, endLine: 4});

		await waitFor(() => expect(highlightedLineIds()).toStrictEqual(["L3", "L4"]));
		expect(scrollIntoView.mock.calls).toStrictEqual([[{block: "center"}]]);
	});

	it("wraps by default with a tab size of 4", async () => {
		textFile(SOURCE, "\tconst alice = 1;");
		renderView({path: SOURCE});

		const code = await waitFor(() => {
			const element = document.querySelector<HTMLElement>("#L1 code");
			if (element === null) throw new Error("not rendered");
			return element;
		});
		expect({
			wraps: code.className.includes("whitespace-pre-wrap"),
			tabSize: code.closest<HTMLElement>("[data-file-source]")?.style.tabSize,
		}).toStrictEqual({wraps: true, tabSize: "4"});
	});

	it("virtualizes files over 2k lines and still reaches a targeted line", async () => {
		textFile(SOURCE, Array.from({length: 5000}, (_, index) => `line ${index + 1}`).join("\n"));
		renderView({path: SOURCE, line: 4500});

		await waitFor(() => expect(highlightedLineIds()).toStrictEqual(["L4500"]));
		expect({
			mountedRowsBelowCap: document.querySelectorAll("[data-file-source] [role=row]").length < 1000,
			target: document.querySelector("#L4500 code")?.textContent,
			scrolls: scrollIntoView.mock.calls,
		}).toStrictEqual({
			mountedRowsBelowCap: true,
			target: "line 4500",
			scrolls: [[{block: "center"}]],
		});
	});

	it("shows Couldn’t find this file for a missing file", async () => {
		renderView({path: "/home/alice/missing.ts"});

		expect((await screen.findByText("Couldn’t find this file")).textContent).toBe("Couldn’t find this file");
	});
});

describe("find in file", () => {
	const SOURCE = "/home/alice/project/agent.ts";
	const README = "/home/alice/notes/README.md";

	function viewer(): HTMLElement {
		const element = document.querySelector<HTMLElement>("[data-file-viewer]");
		if (element === null) throw new Error("no viewer");
		return element;
	}

	function findInput(): HTMLInputElement {
		return screen.getByRole<HTMLInputElement>("textbox", {name: "Find in file"});
	}

	function counter(): string | null | undefined {
		return document.querySelector("[data-find-counter]")?.textContent;
	}

	it("opens on ⌘F inside the pane, counts source matches with smart-case and steps with Enter / ⇧Enter", async () => {
		textFile(SOURCE, "const alice = 1;\nconst bob = alice;\nconst Alice = bob;");
		renderView({path: SOURCE});
		await waitFor(() => expect(document.querySelector("#L3 code")).not.toBeNull());

		const opened = fireEvent.keyDown(viewer(), {key: "f", ctrlKey: true});
		fireEvent.change(findInput(), {target: {value: "alice"}});
		const lowercase = counter();
		fireEvent.keyDown(findInput(), {key: "Enter"});
		const afterNext = counter();
		fireEvent.keyDown(findInput(), {key: "Enter", shiftKey: true});
		fireEvent.keyDown(findInput(), {key: "Enter", shiftKey: true});
		const afterPreviousWrap = counter();
		fireEvent.change(findInput(), {target: {value: "Alice"}});
		const exactCase = counter();
		fireEvent.change(findInput(), {target: {value: "carol"}});

		expect({
			defaultPrevented: !opened,
			placeholder: findInput().placeholder,
			focused: document.activeElement === findInput(),
			lowercase,
			afterNext,
			afterPreviousWrap,
			exactCase,
			missing: counter(),
		}).toStrictEqual({
			defaultPrevented: true,
			placeholder: "Find in file…",
			focused: true,
			lowercase: "1 of 3",
			afterNext: "2 of 3",
			afterPreviousWrap: "3 of 3",
			exactCase: "1 of 1",
			missing: "No results",
		});
	});

	it("closes on Escape and with the Close find bar button", async () => {
		textFile(SOURCE, "alice");
		renderView({path: SOURCE});
		await waitFor(() => expect(document.querySelector("#L1 code")).not.toBeNull());

		fireEvent.keyDown(viewer(), {key: "f", ctrlKey: true});
		fireEvent.keyDown(findInput(), {key: "Escape"});
		const afterEscape = screen.queryByRole("textbox", {name: "Find in file"});
		fireEvent.keyDown(viewer(), {key: "f", ctrlKey: true});
		fireEvent.click(screen.getByRole("button", {name: "Close find bar"}));

		expect({
			afterEscape,
			afterClose: screen.queryByRole("textbox", {name: "Find in file"}),
		}).toStrictEqual({afterEscape: null, afterClose: null});
	});

	it("leaves ⌘F alone when focus is outside the pane", async () => {
		textFile(SOURCE, "alice");
		renderView({path: SOURCE});
		await waitFor(() => expect(document.querySelector("#L1 code")).not.toBeNull());

		const notPrevented = fireEvent.keyDown(document.body, {key: "f", ctrlKey: true});

		expect({
			notPrevented,
			bar: screen.queryByRole("textbox", {name: "Find in file"}),
		}).toStrictEqual({notPrevented: true, bar: null});
	});

	it("opens prefilled from the content search query with the match on the target line active", async () => {
		textFile(SOURCE, "needle one\nhay\nneedle two\nneedle three");
		renderView({path: SOURCE, line: 3, findQuery: "needle"});

		await waitFor(() => expect(counter()).toBe("2 of 3"));
		expect(findInput().value).toBe("needle");
	});

	it("counts every match in a virtualized file, including unmounted lines", async () => {
		textFile(
			SOURCE,
			Array.from({length: 5000}, (_, index) => (index % 1000 === 999 ? "needle" : "hay")).join("\n"),
		);
		renderView({path: SOURCE});
		await waitFor(() => expect(document.querySelector("#L1 code")).not.toBeNull());

		fireEvent.keyDown(viewer(), {key: "f", ctrlKey: true});
		fireEvent.change(findInput(), {target: {value: "needle"}});
		fireEvent.keyDown(findInput(), {key: "Enter", shiftKey: true});

		await waitFor(() => expect(document.querySelector("#L5000 code")?.textContent).toBe("needle"));
		expect(counter()).toBe("5 of 5");
	});

	it("finds text in rendered markdown", async () => {
		textFile(README, "# Alice notes\n\nAlice met **alice** and bob.");
		renderView({path: README});
		await screen.findByRole("heading", {name: "Alice notes"});

		fireEvent.keyDown(viewer(), {key: "f", ctrlKey: true});
		fireEvent.change(findInput(), {target: {value: "alice"}});
		const all = counter();
		fireEvent.change(findInput(), {target: {value: "notes"}});

		expect({all, one: counter()}).toStrictEqual({all: "1 of 3", one: "1 of 1"});
	});
});
