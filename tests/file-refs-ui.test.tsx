// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ProseMarkdown, SessionFileRefs} from "../src/components/file-refs";
import {FileRefsProvider} from "../src/components/file-refs-context";
import {FilesPaneView} from "../src/components/panes/files-pane";
import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {KeyValueCard, TruncatedFilePathHeader} from "../src/components/tool-renderers/shared";
import {ToolOutputSection} from "../src/components/tool-renderers/tool-output-section";
import type {FileRef} from "../src/lib/file-refs";
import type {SessionFiles} from "../src/lib/session-files";
import {UserPlainText} from "../src/components/user-plain-text";
import {markFileRefMissing} from "../src/lib/missing-file-refs";
import {installLocalStorage} from "./fake-storage";

const EXISTING = ["/repo/.mise/config.toml", "/repo/src/app.ts", "/repo/tool-results/mcp-search-1.txt"];
const OUTSIDE = new Set(["/tmp/outside/notes.txt"]);

const MISSING_REASON =
	"Couldn’t find this file, so it can’t be opened. You can ask Claude to create it or check the path.";
const OUTSIDE_REASON = "This file is outside this session’s folders, so it can’t be opened here.";

function fileRefStatus(path: string): "exists" | "missing" | "outside"
{
	if (EXISTING.includes(path)) return "exists";
	return OUTSIDE.has(path) ? "outside" : "missing";
}

const EMPTY_SESSION_FILES =
{
	files: [],
	totalCount: 0,
	counts:
	{
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

class FakeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
	takeRecords()
	{
		return [];
	}
}

const statRequests: string[][] = [];
/** How long `/api/file-refs` takes to answer, for the busy-state tests. */
let statDelayMs = 0;

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
{
	const url = String(input);
	if (url === "/api/file-refs")
	{
		const {paths} = JSON.parse(String(init?.body)) as
		{
			paths: string[];
		};
		statRequests.push(paths);
		if (statDelayMs > 0)
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, statDelayMs);
			});
		}
		return Promise.resolve(
			Response.json(
				{
					statuses: Object.fromEntries(paths.map((path) => [path, fileRefStatus(path)])),
				},
			),
		);
	}
	if (url.startsWith("/api/file/"))
	{
		return Promise.resolve(
			Response.json(
				{
					content: "[tools]\n",
					path: EXISTING[0],
				},
			),
		);
	}
	return Promise.resolve(
		Response.json(
			{
				error: "not found",
			},
			{
				status: 404,
			},
		),
	);
}

function withQueryClient(children: ReactNode)
{
	const client = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() =>
{
	installLocalStorage();
	statRequests.length = 0;
	statDelayMs = 0;
	vi.stubGlobal("fetch", vi.fn(fakeFetch));
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect(
			{
				x: 0,
				y: 0,
				width: 1200,
				height: 800,
			},
		),
	);
});

afterEach(() =>
{
	vi.useRealTimers();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const MESSAGE = "Set it in `.mise/config.toml`, not `mise.toml`; logs go to `logs/`. See `src/app.ts:12-20`.";

describe("ProseMarkdown file refs", () =>
{
	it("links only inline code the server confirmed exists, as prose-link buttons without the code chip", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "refs-test",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ProseMarkdown markdown={MESSAGE} />
				</FileRefsProvider>,
			),
		);

		await waitFor(() =>
		{
			expect(container.querySelectorAll("[data-file-ref]")).toHaveLength(2);
		});
		const refs = [...container.querySelectorAll<HTMLElement>("[data-file-ref]")];
		expect(
			{
				refs: refs.map((ref) => (
				{
					text: ref.textContent,
					role: ref.getAttribute("role"),
					tabIndex: ref.getAttribute("tabindex"),
					className: ref.className,
					title: ref.getAttribute("title"),
					hasCode: ref.querySelector("code") !== null,
				})),
				plainCode: [...container.querySelectorAll("code")].map((code) => code.textContent),
			},
		).toStrictEqual(
			{
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
			},
		);

		fireEvent.click(refs[0]!);
		fireEvent.keyDown(
			refs[1]!,
			{
				key: "Enter",
			},
		);
		expect(open.mock.calls).toStrictEqual([
			[
				{
					path: "/repo/.mise/config.toml",
				},
			],
			[
				{
					path: "/repo/src/app.ts",
					line: 12,
					endLine: 20,
				},
			],
		]);
	});

	it("links a markdown link to an existing file as a file-ref button and drops a dead link to an unknown one", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "link-refs",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ProseMarkdown markdown="See [the app](src/app.ts#top) and [web](https://example.com/x.ts)." />
				</FileRefsProvider>,
			),
		);

		await waitFor(() =>
		{
			expect(container.querySelectorAll("[data-file-ref]")).toHaveLength(1);
		});
		const ref = container.querySelector<HTMLElement>("[data-file-ref]")!;
		expect(
			{
				text: ref.textContent,
				role: ref.getAttribute("role"),
				links: [...container.querySelectorAll("a")].map((link) => link.getAttribute("href")),
			},
		).toStrictEqual(
			{
				text: "the app",
				role: "button",
				links: ["https://example.com/x.ts"],
			},
		);

		fireEvent.click(ref);
		expect(open.mock.calls).toStrictEqual([
			[
				{
					path: "/repo/src/app.ts",
				},
			],
		]);
	});

	it("renders an outside-roots path as blocked code with its reason, shown in a tooltip on hover", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "refs-test",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ProseMarkdown markdown="Notes are in `/tmp/outside/notes.txt`." />
				</FileRefsProvider>,
			),
		);

		const wrapper = await waitFor(() =>
		{
			const found = container.querySelector<HTMLElement>("[data-cds-disabled-reason-wrapper]");
			expect(found).not.toBeNull();
			return found!;
		});
		const reasonId = wrapper.getAttribute("aria-describedby")!;
		expect(
			{
				html: wrapper.outerHTML,
				refs: container.querySelectorAll("[data-file-ref]").length,
			},
		).toStrictEqual(
			{
				html: `<span tabindex="0" data-cds-disabled-reason-wrapper="" aria-describedby="${reasonId}" class="inline rounded-sm focus-visible:outline-hidden focus-visible:shadow-focus"><code data-inline-code="" data-file-ref-blocked="">/tmp/outside/notes.txt</code><span id="${reasonId}" hidden="" data-cds-disabled-reason="">${OUTSIDE_REASON}</span></span>`,
				refs: 0,
			},
		);

		fireEvent.click(wrapper);
		fireEvent.pointerOver(wrapper.querySelector("code")!);
		const tooltip = await screen.findByRole("tooltip");
		expect(
			{
				text: tooltip.textContent,
				side: tooltip.getAttribute("data-side"),
				opened: open.mock.calls,
			},
		).toStrictEqual(
			{
				text: OUTSIDE_REASON,
				side: "top",
				opened: [],
			},
		);
		fireEvent.pointerOut(
			wrapper,
			{
				relatedTarget: document.body,
			},
		);
		expect(screen.queryByRole("tooltip")).toBeNull();

		act(() =>
		{
			wrapper.focus();
		});
		expect(screen.getByRole("tooltip").textContent).toBe(OUTSIDE_REASON);
		act(() =>
		{
			wrapper.blur();
		});
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("links a missing path optimistically, and on click shows busy past 150ms, then the blocked missing state with focus kept", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "missing-slow",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ProseMarkdown markdown="Create `src/new.ts:3` next." />
				</FileRefsProvider>,
			),
		);
		const link = await waitFor(() =>
		{
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

		const wrapper = container.querySelector<HTMLElement>("[data-cds-disabled-reason-wrapper]");
		const reasonId = wrapper?.getAttribute("aria-describedby") ?? "";
		expect(
			{
				refs: container.querySelectorAll("[data-file-ref]").length,
				html: wrapper?.outerHTML,
				focused: document.activeElement === wrapper,
				opened: open.mock.calls,
			},
		).toStrictEqual(
			{
				refs: 0,
				html: `<span tabindex="0" data-cds-disabled-reason-wrapper="" aria-describedby="${reasonId}" class="inline rounded-sm focus-visible:outline-hidden focus-visible:shadow-focus"><code data-inline-code="" data-file-ref-blocked="">src/new.ts:3</code><span hidden=""></span><span id="${reasonId}" hidden="" data-cds-disabled-reason="">${MISSING_REASON}</span></span>`,
				focused: true,
				opened: [],
			},
		);
	});

	it("hands focus to the focus slot's wrapper when a focused ref turns missing without being clicked", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "missing-elsewhere",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ProseMarkdown markdown="Create `src/new.ts` next." />
				</FileRefsProvider>,
			),
		);
		const link = await waitFor(() =>
		{
			const found = container.querySelector<HTMLElement>("[data-file-ref]");
			expect(found).not.toBeNull();
			return found!;
		});
		link.focus();
		act(() =>
		{
			markFileRefMissing("missing-elsewhere", "/repo/src/new.ts");
		});

		const wrapper = container.querySelector<HTMLElement>("[data-cds-disabled-reason-wrapper]");
		expect(
			{
				blocked: wrapper !== null,
				focused: document.activeElement === wrapper,
			},
		).toStrictEqual(
			{
				blocked: true,
				focused: true,
			},
		);
	});

	it("leaves focus alone when an unfocused ref turns missing", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "missing-unfocused",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ProseMarkdown markdown="Create `src/new.ts` next." />
				</FileRefsProvider>,
			),
		);
		await waitFor(() =>
		{
			expect(container.querySelector("[data-file-ref]")).not.toBeNull();
		});
		act(() =>
		{
			markFileRefMissing("missing-unfocused", "/repo/src/new.ts");
		});

		expect(
			{
				blocked: container.querySelector("[data-cds-disabled-reason-wrapper]") !== null,
				focused: document.activeElement === document.body,
			},
		).toStrictEqual(
			{
				blocked: true,
				focused: true,
			},
		);
	});

	it("never shows busy when the missing check settles within 150ms", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "missing-fast",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ProseMarkdown markdown="Create `src/new.ts` next." />
				</FileRefsProvider>,
			),
		);
		const link = await waitFor(() =>
		{
			const found = container.querySelector<HTMLElement>("[data-file-ref]");
			expect(found).not.toBeNull();
			return found!;
		});

		vi.useFakeTimers();
		statDelayMs = 50;
		const busy: (string | null)[] = [];
		const observer = new MutationObserver(() => busy.push(link.getAttribute("aria-busy")));
		observer.observe(
			link,
			{
				attributes: true,
				attributeFilter: ["aria-busy"],
			},
		);
		fireEvent.click(link);
		await act(async () => vi.advanceTimersByTimeAsync(300));
		observer.disconnect();

		expect(
			{
				busy,
				blocked: container.querySelector("[data-cds-disabled-reason-wrapper] [data-cds-disabled-reason]")
					?.textContent,
				opened: open.mock.calls,
			},
		).toStrictEqual(
			{
				busy: [],
				blocked: MISSING_REASON,
				opened: [],
			},
		);
	});

	it("opens an existing file at once, with no busy state or recheck", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "exists-now",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ProseMarkdown markdown="See `src/app.ts`." />
				</FileRefsProvider>,
			),
		);
		const link = await waitFor(() =>
		{
			const found = container.querySelector<HTMLElement>("[data-file-ref]");
			expect(found).not.toBeNull();
			return found!;
		});
		const requestsBefore = statRequests.length;
		fireEvent.click(link);
		expect(
			{
				opened: open.mock.calls,
				busy: link.getAttribute("aria-busy"),
				rechecks: statRequests.length - requestsBefore,
			},
		).toStrictEqual(
			{
				opened: [
					[
						{
							path: "/repo/src/app.ts",
						},
					],
				],
				busy: null,
				rechecks: 0,
			},
		);
	});

	it("⌘- or Ctrl-click opens a ref inside the cwd with its default app, not the Files pane", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const {container} = render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "exists-now",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ProseMarkdown markdown="See `src/app.ts`." />
					<TruncatedFilePathHeader filePath="/repo/.mise/config.toml" />
				</FileRefsProvider>,
			),
		);
		const prose = await waitFor(() =>
		{
			const found = container.querySelector<HTMLElement>(".prose-link[data-file-ref]");
			expect(found).not.toBeNull();
			return found!;
		});
		fireEvent.click(
			prose,
			{
				metaKey: true,
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "/repo/.mise/config.toml",
				},
			),
			{
				ctrlKey: true,
			},
		);
		const openFileBodies = () =>
			vi
				.mocked(fetch)
				.mock.calls.filter(([url]) => String(url) === "/api/open-file")
				.map(([, init]) => JSON.parse(String(init?.body)) as unknown);
		await waitFor(() =>
		{
			expect(openFileBodies()).toHaveLength(2);
		});

		expect(
			{
				opened: openFileBodies(),
				paneOpens: open.mock.calls,
			},
		).toStrictEqual(
			{
				opened: [
					{
						path: "/repo/src/app.ts",
					},
					{
						path: "/repo/.mise/config.toml",
					},
				],
				paneOpens: [],
			},
		);
	});

	it("⌘-click on a ref outside the cwd opens it in the Files pane as a plain click does", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "refs-test",
						cwd: "/repo/src",
						sessionPaths: [],
						open,
					}}
				>
					<TruncatedFilePathHeader filePath="/repo/.mise/config.toml" />
				</FileRefsProvider>,
			),
		);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "/repo/.mise/config.toml",
				},
			),
			{
				metaKey: true,
			},
		);

		expect(
			{
				paneOpens: open.mock.calls,
				openFileCalls: vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/open-file").length,
			},
		).toStrictEqual(
			{
				paneOpens: [
					[
						{
							path: "/repo/.mise/config.toml",
						},
					],
				],
				openFileCalls: 0,
			},
		);
	});

	it("renders plain markdown outside a file-refs provider", () =>
	{
		const {container} = render(withQueryClient(<ProseMarkdown markdown={MESSAGE} />));
		expect(
			{
				refs: container.querySelectorAll("[data-file-ref]").length,
				fetches: statRequests.length,
			},
		).toStrictEqual(
			{
				refs: 0,
				fetches: 0,
			},
		);
	});
});

const USER_LINK_CLASS =
	"aria-busy:cursor-progress aria-busy:opacity-60 inline text-code leading-none text-danger bg-alpha-1 border-0.5 border-border rounded-[0.4em] px-[0.25em] py-[0.0625em] [overflow-wrap:anywhere] hover:bg-alpha-2 underline underline-offset-[3px] decoration-[color-mix(in_srgb,currentColor,transparent_60%)] hover:decoration-current focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus";

function userRow(text: string, open: (ref: FileRef) => void, sessionId = "user-refs", nonInteractive = false)
{
	return render(
		withQueryClient(
			<FileRefsProvider
				value={
				{
					sessionId,
					cwd: "/repo",
					sessionPaths: [],
					open,
				}}
			>
				<UserPlainText text={text} nonInteractive={nonInteractive} />
			</FileRefsProvider>,
		),
	).container;
}

async function userLink(container: HTMLElement): Promise<HTMLElement>
{
	return waitFor(() =>
	{
		const found = container.querySelector<HTMLElement>("bdi > span[role=button]");
		expect(found).not.toBeNull();
		return found!;
	});
}

/** Each code span's isolating bdi, drawn as its outer HTML. */
function bdis(container: HTMLElement): string[]
{
	return Array.from(container.querySelectorAll("bdi"), (bdi) => bdi.outerHTML);
}

const USER_CODE = (text: string) =>
	`<bdi dir="ltr"><code class="text-code leading-none text-danger bg-alpha-1 border-0.5 border-border rounded-[0.4em] px-[0.25em] py-[0.0625em] [overflow-wrap:anywhere]">${text}</code></bdi>`;

describe("UserPlainText code-span file links (upstream U > Ir)", () =>
{
	it("links only a path-shaped span as upstream's underlined code-chip button, opening it on click and Enter", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const container = userRow("see `src/app.ts:3` and `README.md` and `npm run build`", open);
		const link = await userLink(container);

		expect(bdis(container)).toStrictEqual([
			`<bdi dir="ltr"><span role="button" tabindex="0" data-file-ref="" data-file-path="/repo/src/app.ts" data-file-line="3" class="${USER_LINK_CLASS}">src/app.ts:3</span></bdi>`,
			USER_CODE("README.md"),
			USER_CODE("npm run build"),
		]);

		fireEvent.click(link);
		fireEvent.keyDown(
			link,
			{
				key: "Enter",
			},
		);
		await waitFor(() =>
		{
			expect(open.mock.calls).toStrictEqual([
				[
					{
						path: "/repo/src/app.ts",
						line: 3,
					},
				],
				[
					{
						path: "/repo/src/app.ts",
						line: 3,
					},
				],
			]);
		});
	});

	it("turns busy while a slow check runs past 150ms, then re-renders missing as the blocked wrapper with focus on it", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const container = userRow("create `src/new.ts`", open, "user-missing");
		const link = await userLink(container);

		vi.useFakeTimers();
		statDelayMs = 200;
		link.focus();
		fireEvent.click(link);
		await act(async () => vi.advanceTimersByTimeAsync(160));
		expect(link.getAttribute("aria-busy")).toBe("true");
		await act(async () => vi.advanceTimersByTimeAsync(100));

		const wrapper = container.querySelector<HTMLElement>("[data-cds-disabled-reason-wrapper]");
		const reasonId = wrapper?.getAttribute("aria-describedby") ?? "";
		expect(
			{
				bdis: bdis(container),
				focused: document.activeElement === wrapper,
				opened: open.mock.calls,
			},
		).toStrictEqual(
			{
				bdis: [
					`<bdi dir="ltr"><span tabindex="0" data-cds-disabled-reason-wrapper="" aria-describedby="${reasonId}" class="inline rounded-sm focus-visible:outline-hidden focus-visible:shadow-focus"><code class="text-code leading-none text-danger bg-alpha-1 border-0.5 border-border rounded-[0.4em] px-[0.25em] py-[0.0625em] [overflow-wrap:anywhere]">src/new.ts</code><span hidden=""></span><span id="${reasonId}" hidden="" data-cds-disabled-reason="">${MISSING_REASON}</span></span></bdi>`,
				],
				focused: true,
				opened: [],
			},
		);
	});

	it("hands focus to the focus slot's wrapper when a focused user-row link turns missing without being clicked", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const container = userRow("create `src/new.ts`", open, "user-missing-elsewhere");
		const link = await userLink(container);
		link.focus();
		act(() =>
		{
			markFileRefMissing("user-missing-elsewhere", "/repo/src/new.ts");
		});

		const wrapper = container.querySelector<HTMLElement>("bdi > [data-cds-disabled-reason-wrapper]");
		expect(
			{
				blocked: wrapper !== null,
				focused: document.activeElement === wrapper,
			},
		).toStrictEqual(
			{
				blocked: true,
				focused: true,
			},
		);
	});

	it("blocks an outside-roots path with its reason in a top tooltip on hover and focus", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const container = userRow("notes in `/tmp/outside/notes.txt`", open);
		const wrapper = await waitFor(() =>
		{
			const found = container.querySelector<HTMLElement>("bdi > [data-cds-disabled-reason-wrapper]");
			expect(found).not.toBeNull();
			return found!;
		});
		const reasonId = wrapper.getAttribute("aria-describedby") ?? "";

		expect(bdis(container)).toStrictEqual([
			`<bdi dir="ltr"><span tabindex="0" data-cds-disabled-reason-wrapper="" aria-describedby="${reasonId}" class="inline rounded-sm focus-visible:outline-hidden focus-visible:shadow-focus"><code class="text-code leading-none text-danger bg-alpha-1 border-0.5 border-border rounded-[0.4em] px-[0.25em] py-[0.0625em] [overflow-wrap:anywhere]">/tmp/outside/notes.txt</code><span id="${reasonId}" hidden="" data-cds-disabled-reason="">${OUTSIDE_REASON}</span></span></bdi>`,
		]);

		fireEvent.pointerOver(wrapper.querySelector("code")!);
		const tooltip = await screen.findByRole("tooltip");
		expect(
			{
				text: tooltip.textContent,
				side: tooltip.getAttribute("data-side"),
			},
		).toStrictEqual(
			{
				text: OUTSIDE_REASON,
				side: "top",
			},
		);
		fireEvent.pointerOut(
			wrapper,
			{
				relatedTarget: document.body,
			},
		);
		expect(screen.queryByRole("tooltip")).toBeNull();
		act(() =>
		{
			wrapper.focus();
		});
		expect(screen.getByRole("tooltip").textContent).toBe(OUTSIDE_REASON);
	});

	it("⌘-click opens the file with its default app instead of the Files pane", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const link = await userLink(userRow("see `src/app.ts`", open));
		fireEvent.click(
			link,
			{
				metaKey: true,
			},
		);
		const openFileBodies = () =>
			vi
				.mocked(fetch)
				.mock.calls.filter(([url]) => String(url) === "/api/open-file")
				.map(([, init]) => JSON.parse(String(init?.body)) as unknown);
		await waitFor(() =>
		{
			expect(openFileBodies()).toHaveLength(1);
		});
		expect(
			{
				opened: openFileBodies(),
				paneOpens: open.mock.calls,
			},
		).toStrictEqual(
			{
				opened: [
					{
						path: "/repo/src/app.ts",
					},
				],
				paneOpens: [],
			},
		);
	});

	it("never links a nonInteractive (pending) prompt or a prompt outside a file-refs provider", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const pending = userRow("see `src/app.ts`", open, "user-refs", true);
		const bare = render(<UserPlainText text="see `src/app.ts`" />).container;
		await act(async () => Promise.resolve());

		expect(
			{
				pending: bdis(pending),
				bare: bdis(bare),
				stats: statRequests,
			},
		).toStrictEqual(
			{
				pending: [USER_CODE("src/app.ts")],
				bare: [USER_CODE("src/app.ts")],
				stats: [],
			},
		);
	});
});

describe("TruncatedFilePathHeader file refs", () =>
{
	it("becomes clickable once the path is confirmed, and dispatches open", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "refs-test",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<TruncatedFilePathHeader filePath="/repo/src/app.ts" />
					<TruncatedFilePathHeader filePath="/repo/deleted.ts" />
					<TruncatedFilePathHeader filePath="/tmp/outside/notes.txt" />
				</FileRefsProvider>,
			),
		);

		const button = await screen.findByRole(
			"button",
			{
				name: "/repo/src/app.ts",
			},
		);
		fireEvent.click(button);
		expect(
			{
				calls: open.mock.calls,
				deletedIsButton:
					screen.queryByRole(
						"button",
						{
							name: "/repo/deleted.ts",
						},
					) !== null,
				outsideIsButton:
					screen.queryByRole(
						"button",
						{
							name: "/tmp/outside/notes.txt",
						},
					) !== null,
			},
		).toStrictEqual(
			{
				calls: [
					[
						{
							path: "/repo/src/app.ts",
						},
					],
				],
				deletedIsButton: false,
				outsideIsButton: false,
			},
		);
	});
});

describe("ToolOutputSection saved-file link (upstream Rv > La)", () =>
{
	it("links the saved file by its last name with upstream's inline link classes, opening it in the Files pane", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const path = "/repo/tool-results/mcp-search-1.txt";
		render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "saved-file",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<ToolOutputSection
						output={
						{
							note:
							{
								kind: "saved",
								path,
							},
							toldClaude: "told",
						}}
					/>
				</FileRefsProvider>,
			),
		);
		const link = await screen.findByRole(
			"button",
			{
				name: "mcp-search-1.txt",
			},
		);
		fireEvent.click(link);
		expect(
			{
				className: link.className,
				path: link.getAttribute("data-file-path"),
				opened: open.mock.calls,
			},
		).toStrictEqual(
			{
				className:
					"inline box-decoration-clone text-upstream-accent hover:underline underline-offset-[1px] focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus rounded-r2 break-words",
				path,
				opened: [
					[
						{
							path,
						},
					],
				],
			},
		);
	});

	it("keeps a blocked path's chip inside upstream's disabled-reason wrapper (Ia > Jr)", async () =>
	{
		const path = "/tmp/outside/notes.txt";
		render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "param-outside",
						cwd: "/repo",
						sessionPaths: [],
						open: vi.fn<(ref: FileRef) => void>(),
					}}
				>
					<KeyValueCard
						params={[
							{
								key: "file_path",
								value: path,
							},
						]}
					/>
				</FileRefsProvider>,
			),
		);
		const wrapper = await vi.waitFor(() =>
		{
			const found = document.querySelector<HTMLElement>("[data-cds-disabled-reason-wrapper]");
			if (found === null) throw new Error("no wrapper yet");
			return found;
		});
		expect(
			{
				parent: wrapper.parentElement?.className,
				className: wrapper.className,
				tabIndex: wrapper.tabIndex,
				code: wrapper.querySelector("code")?.outerHTML,
				reason: document.getElementById(wrapper.getAttribute("aria-describedby") ?? "")?.textContent,
			},
		).toStrictEqual(
			{
				parent: "min-w-0 break-words",
				className: "inline rounded-sm focus-visible:outline-hidden focus-visible:shadow-focus",
				tabIndex: 0,
				code: `<code class="cds-inline-code">${path}</code>`,
				reason: OUTSIDE_REASON,
			},
		);
	});
});

describe("KeyValueCard path param link (upstream Zv > Ra)", () =>
{
	it("links a confirmed file_path with upstream's inline link class around a span, opening it in the Files pane", async () =>
	{
		const open = vi.fn<(ref: FileRef) => void>();
		const path = "/repo/src/app.ts";
		render(
			withQueryClient(
				<FileRefsProvider
					value={
					{
						sessionId: "param-path",
						cwd: "/repo",
						sessionPaths: [],
						open,
					}}
				>
					<KeyValueCard
						params={[
							{
								key: "file_path",
								value: path,
							},
						]}
					/>
				</FileRefsProvider>,
			),
		);
		const link = await screen.findByRole(
			"button",
			{
				name: path,
			},
		);
		fireEvent.click(link);
		expect(
			{
				wrapper: link.parentElement?.className,
				className: link.className,
				inner: [...link.children].map((child) => child.tagName),
				code: link.parentElement?.querySelector("code"),
				opened: open.mock.calls,
			},
		).toStrictEqual(
			{
				wrapper: "min-w-0 break-words",
				className:
					"inline box-decoration-clone text-upstream-accent hover:underline underline-offset-[1px] focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus rounded-r2",
				inner: ["SPAN"],
				code: null,
				opened: [
					[
						{
							path,
						},
					],
				],
			},
		);
	});
});

describe("SessionFileRefs", () =>
{
	let unregister: () => void = () =>
	{
	};

	afterEach(() =>
	{
		unregister();
	});

	it("clicking a transcript ref opens the closed Files pane with a preview tab", async () =>
	{
		unregister = registerPane(
			"files",
			{
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
			},
		);
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

		await waitFor(() =>
		{
			expect(container.querySelectorAll("[data-file-ref]")).toHaveLength(2);
		});
		expect(
			screen.queryByRole(
				"region",
				{
					name: "Files",
				},
			),
		).toBeNull();
		act(() =>
		{
			container.querySelector<HTMLElement>("[data-file-ref]")!.click();
		});

		const tab = await screen.findByRole(
			"tab",
			{
				name: /config\.toml/,
			},
		);
		expect(
			{
				paneOpen:
					screen.queryByRole(
						"region",
						{
							name: "Files",
						},
					) !== null,
				selected: tab.getAttribute("aria-selected"),
				preview: tab.className.includes("italic"),
			},
		).toStrictEqual(
			{
				paneOpen: true,
				selected: "true",
				preview: true,
			},
		);
	});
});
