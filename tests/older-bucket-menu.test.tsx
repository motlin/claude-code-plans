// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {type FetchAllResult, OlderBucketMenu} from "../src/components/sidebar/older-bucket-menu";
import {ToastProvider} from "../src/components/toast";

const archived: string[] = [];

beforeEach(() =>
{
	archived.length = 0;
	vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
	{
		archived.push(`${init?.method ?? "GET"} ${String(input)}`);
		return Promise.resolve(
			new Response(
				JSON.stringify(
					{
						archived: true,
					},
				),
				{
					status: 200,
					headers:
					{
						"Content-Type": "application/json",
					},
				},
			),
		);
	});
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

async function flush()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

/** A fetch-all held until `resolve`, whose release calls are counted. */
function deferredFetchAll()
{
	let resolve: (result: Omit<FetchAllResult, "release">) => void = () =>
	{
	};
	const released: string[] = [];
	const onFetchAll = vi.fn<() => Promise<FetchAllResult>>(async () =>
	{
		const {exhausted} = await new Promise<Omit<FetchAllResult, "release">>((done) =>
		{
			resolve = done;
		});
		return {
			exhausted,
			release: () =>
			{
				released.push("release");
			},
		};
	});
	return {
		onFetchAll,
		released,
		resolve: async (exhausted: boolean) =>
		{
			act(() =>
			{
				resolve(
					{
						exhausted,
					},
				);
			});
			await flush();
		},
	};
}

function renderMenu(props: Parameters<typeof OlderBucketMenu>[0])
{
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<ToastProvider>
				<OlderBucketMenu {...props} />
			</ToastProvider>
		</QueryClientProvider>,
	);
}

function trigger(): HTMLElement
{
	return screen.getByRole(
		"button",
		{
			name: "Bulk actions for older sessions",
		},
	);
}

async function menuItems(): Promise<string[]>
{
	fireEvent.click(trigger());
	await flush();
	const menu = await waitFor(() => screen.getByRole("menu"));
	return [...menu.querySelectorAll("[role=menuitem]")].map((item) => item.textContent);
}

async function pickArchiveAll(): Promise<void>
{
	fireEvent.click(trigger());
	await flush();
	fireEvent.click(await waitFor(() => screen.getByRole("menuitem")));
	await flush();
	await flush();
}

function dialogState()
{
	const dialog = screen.queryByRole("alertdialog");
	if (dialog === null) return null;
	return {
		title: dialog.querySelector("h2")?.textContent,
		status: within(dialog).getByRole("status").textContent,
		confirmDisabled: screen
			.getByRole(
				"button",
				{
					name: "Archive all",
				},
			)
			.hasAttribute("disabled"),
	};
}

describe("OlderBucketMenu", () =>
{
	it("renders nothing with no archivable older session", () =>
	{
		renderMenu(
			{
				ids: [],
				listHasMore: false,
			},
		);
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("draws upstream AG's hidden-until-hover ghost trigger", () =>
	{
		renderMenu(
			{
				ids: ["a"],
				listHasMore: false,
			},
		);
		const button = trigger();
		const classes = new Set(button.className.split(" "));
		expect(
			{
				tooltip: button.getAttribute("title"),
				haspopup: button.getAttribute("aria-haspopup"),
				tokens: [
					"df-chrome-btn",
					"df-touch-reveal",
					"-my-1",
					"size-6",
					"opacity-0",
					"group-hover/labelrow:opacity-60",
					"group-focus-within/labelrow:opacity-60",
					"hover:!opacity-100",
					"focus-visible:!opacity-100",
					"aria-expanded:!opacity-100",
				].filter((token) => !classes.has(token)),
				glyph: button.querySelector("svg") !== null,
			},
		).toStrictEqual(
			{
				tooltip: null,
				haspopup: "menu",
				tokens: [],
				glyph: true,
			},
		);
	});

	it("counts Archive all only once the feed is exhausted", async () =>
	{
		const exhausted = renderMenu(
			{
				ids: ["a", "b", "c"],
				listHasMore: false,
			},
		);
		const counted = await menuItems();
		exhausted.unmount();
		renderMenu(
			{
				ids: ["a", "b", "c"],
				listHasMore: true,
			},
		);
		expect(
			{
				counted,
				more: await menuItems(),
			},
		).toStrictEqual(
			{
				counted: ["Archive all (3)"],
				more: ["Archive all"],
			},
		);
	});

	it("counts while the drain runs, then confirms with the truncated copy, and Cancel releases the pages once", async () =>
	{
		const drain = deferredFetchAll();
		renderMenu(
			{
				ids: ["a", "b", "c"],
				listHasMore: true,
				onFetchAll: drain.onFetchAll,
			},
		);
		await pickArchiveAll();
		const whileCounting = dialogState();
		await drain.resolve(false);
		const counted = dialogState();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		await flush();

		expect(
			{
				whileCounting,
				counted,
				released: drain.released,
				archived,
			},
		).toStrictEqual(
			{
				whileCounting:
				{
					title: "Archive older sessions?",
					status: "Counting sessions older than a week…",
					confirmDisabled: true,
				},
				counted:
				{
					title: "Archive older sessions?",
					status: "This will archive 3 sessions older than a week. Pinned sessions aren’t affected. Not all sessions could be loaded, so some older sessions will remain.",
					confirmDisabled: false,
				},
				released: ["release"],
				archived: [],
			},
		);
	});

	it("releases a drain that lands after the dialog closed", async () =>
	{
		const drain = deferredFetchAll();
		renderMenu(
			{
				ids: ["a"],
				listHasMore: true,
				onFetchAll: drain.onFetchAll,
			},
		);
		await pickArchiveAll();
		fireEvent.keyDown(
			screen.getByRole("alertdialog"),
			{
				key: "Escape",
			},
		);
		await flush();
		const releasedBeforeLanding = [...drain.released];
		await drain.resolve(true);

		expect(
			{
				releasedBeforeLanding,
				released: drain.released,
			},
		).toStrictEqual(
			{
				releasedBeforeLanding: [],
				released: ["release"],
			},
		);
	});

	it("archives every id, releases the pages and toasts the older copy on confirm", async () =>
	{
		const drain = deferredFetchAll();
		renderMenu(
			{
				ids: ["a", "b", "c"],
				listHasMore: false,
				onFetchAll: drain.onFetchAll,
			},
		);
		await pickArchiveAll();
		await drain.resolve(true);
		const counted = dialogState();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Archive all",
				},
			),
		);
		await waitFor(() => screen.getByText("Archived 3 older sessions"));

		expect(
			{
				counted: counted?.status,
				released: drain.released,
				archived,
			},
		).toStrictEqual(
			{
				counted: "This will archive 3 sessions older than a week. Pinned sessions aren’t affected.",
				released: ["release"],
				archived: [
					"PUT /api/sessions/a/archived",
					"PUT /api/sessions/b/archived",
					"PUT /api/sessions/c/archived",
				],
			},
		);
	});
});
