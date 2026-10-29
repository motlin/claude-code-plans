// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {UrlElicitationDock} from "../src/components/url-elicitation-dock";
import {parseElicitationDialog} from "../src/lib/herdr/elicitation-keys";
import {URL_ACCEPT_FOCUSED} from "./fixtures/elicitation-screens";

afterEach(cleanup);

const CARD = {
	key: "elicitation:elicit-url-1",
	serverName: "spike-elicit",
	message: "Open the spike page (url-decline)",
	url: "https://example.com/spike",
};

describe("UrlElicitationDock", () => {
	it("reads the terminal dialog, then posts Open as an allow of kind url", async () => {
		const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
			Promise.resolve(
				init?.method === "POST"
					? Response.json({ok: true})
					: Response.json({dialog: parseElicitationDialog(URL_ACCEPT_FOCUSED)}),
			),
		);
		render(
			<QueryClientProvider client={new QueryClient()}>
				<UrlElicitationDock sessionId="session-1" card={CARD} fetcher={fetcher} />
			</QueryClientProvider>,
		);

		const open = screen.getByRole("button", {name: "Open"});
		await waitFor(() => {
			expect(open.hasAttribute("disabled")).toStrictEqual(false);
		});
		fireEvent.click(open);
		await waitFor(() => {
			expect(fetcher.mock.calls.length).toStrictEqual(2);
		});

		expect(fetcher.mock.calls).toStrictEqual([
			["/api/herdr/elicitation?sessionId=session-1", {credentials: "same-origin"}],
			[
				"/api/herdr/elicitation",
				{
					method: "POST",
					credentials: "same-origin",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({sessionId: "session-1", decision: "allow", kind: "url"}),
				},
			],
		]);
	});

	it("keeps Open off with the unavailable reason when the dialog can't be read", async () => {
		const fetcher = vi.fn<typeof fetch>(async () =>
			Promise.resolve(Response.json({error: "The terminal is not showing this elicitation"}, {status: 409})),
		);
		render(
			<QueryClientProvider client={new QueryClient()}>
				<UrlElicitationDock sessionId="session-1" card={CARD} fetcher={fetcher} />
			</QueryClientProvider>,
		);

		await waitFor(() => {
			expect(document.querySelector("[data-cds-disabled-reason]")?.textContent).toStrictEqual(
				"Claude Code won't open this URL from here. Check it in the terminal.",
			);
		});
	});
});
