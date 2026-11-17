// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {RefusalFallbackDock} from "../src/components/refusal-fallback-dock";
import {useRefusalFallbackDialog} from "../src/hooks/use-refusal-fallback-dialog";
import {showsWaitingForInputNotice} from "../src/components/waiting-for-input-notice";
import {parseRefusalFallbackDialog} from "../src/lib/herdr/refusal-fallback";
import {REFUSAL_DIALOG} from "./fixtures/refusal-fallback-screens";

const composer = vi.hoisted(() => (
{
	refill: vi.fn<(sessionId: string, text: string) => boolean>(() => true),
	focus: vi.fn<(sessionId: string) => boolean>(() => true),
}));

vi.mock("../src/lib/context-attach", () => (
{
	refillComposer: composer.refill,
	focusComposer: composer.focus,
}));

afterEach(cleanup);
beforeEach(() =>
{
	composer.refill.mockClear();
	composer.focus.mockClear();
});

/** The session page's slice: the dialog query, the dock, and the waiting notice it steps aside for. */
function Slot({dialogOpenAt, fetcher}: {dialogOpenAt: number | null; fetcher: typeof fetch})
{
	const dialog = useRefusalFallbackDialog("session-1", dialogOpenAt, fetcher);
	const notice = showsWaitingForInputNotice(
		{
			state: "waiting",
			hasDockedCard: dialog !== null,
			workingLineWaits: false,
		},
	);
	return (
		<>
			{notice && <p>Waiting for your input</p>}
			{dialog !== null && <RefusalFallbackDock sessionId="session-1" dialog={dialog} fetcher={fetcher} />}
		</>
	);
}

function fakeFetch(
	dialog: unknown,
	postBody: unknown =
	{
		ok: true,
	},
)
{
	return vi.fn<typeof fetch>(async (_input, init) =>
		Promise.resolve(
			Response.json(
				init?.method === "POST"
					? postBody
					:
						{
							dialog,
						},
			),
		),
	);
}

function renderSlot(dialogOpenAt: number | null, fetcher: typeof fetch)
{
	render(
		<QueryClientProvider client={new QueryClient()}>
			<Slot dialogOpenAt={dialogOpenAt} fetcher={fetcher} />
		</QueryClientProvider>,
	);
}

describe("RefusalFallbackDock", () =>
{
	it("docks the card in place of the waiting notice when the pane shows the dialog", async () =>
	{
		renderSlot(1000, fakeFetch(parseRefusalFallbackDialog(REFUSAL_DIALOG)));
		await screen.findByRole(
			"group",
			{
				name: "Session paused",
			},
		);
		expect(screen.queryByText("Waiting for your input")).toBeNull();
	});

	it("keeps the waiting notice when the pane shows some other dialog", async () =>
	{
		const fetcher = fakeFetch(null);
		renderSlot(1000, fetcher);
		await waitFor(() =>
		{
			expect(fetcher.mock.calls.length).toStrictEqual(1);
		});
		expect(
			{
				card: screen.queryByRole("group"),
				notice: screen.getByText("Waiting for your input").tagName,
			},
		).toStrictEqual(
			{
				card: null,
				notice: "P",
			},
		);
	});

	it("reads nothing while the registry reports no open dialog", () =>
	{
		const fetcher = fakeFetch(parseRefusalFallbackDialog(REFUSAL_DIALOG));
		renderSlot(null, fetcher);
		expect(fetcher.mock.calls).toStrictEqual([]);
	});

	it("Edit refills and focuses the composer with the prompt the CLI handed back", async () =>
	{
		const fetcher = fakeFetch(
			parseRefusalFallbackDialog(REFUSAL_DIALOG),
			{
				ok: true,
				text: "draft",
			},
		);
		renderSlot(1000, fetcher);
		fireEvent.click(await screen.findByText("Edit prompt and retry with Opus 4.7"));
		await waitFor(() =>
		{
			expect(composer.focus.mock.calls.length).toStrictEqual(1);
		});
		expect(
			{
				post: fetcher.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body,
				refill: composer.refill.mock.calls,
				focus: composer.focus.mock.calls,
			},
		).toStrictEqual(
			{
				post: JSON.stringify(
					{
						sessionId: "session-1",
						choice: "edit_prompt",
					},
				),
				refill: [["session-1", "draft"]],
				focus: [["session-1"]],
			},
		);
	});

	it("Switch posts retry_fallback and refills nothing", async () =>
	{
		const fetcher = fakeFetch(parseRefusalFallbackDialog(REFUSAL_DIALOG));
		renderSlot(1000, fetcher);
		fireEvent.click(await screen.findByText("Switch to Sonnet 4.6"));
		await waitFor(() =>
		{
			expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toStrictEqual(true);
		});
		expect(
			{
				post: fetcher.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body,
				refill: composer.refill.mock.calls,
			},
		).toStrictEqual(
			{
				post: JSON.stringify(
					{
						sessionId: "session-1",
						choice: "retry_fallback",
					},
				),
				refill: [],
			},
		);
	});
});
