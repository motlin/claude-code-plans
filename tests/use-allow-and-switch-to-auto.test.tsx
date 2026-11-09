// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {type AllowAndSwitchToAutoInput, useAllowAndSwitchToAuto} from "../src/components/use-allow-and-switch-to-auto";
import type {PermissionModeConsent} from "../src/lib/api/permission-mode-consent";
import type {HerdrAllowAutoVia} from "../src/lib/api/herdr";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const NOT_CONSENTED: PermissionModeConsent = {autoModeIsDefault: false, autoConsented: false, acks: []};
const AUTO_DEFAULT: PermissionModeConsent = {autoModeIsDefault: true, autoConsented: false, acks: []};

function setup({
	consent,
	mode = "default",
	via = "row",
	sendError = null,
}: {
	consent: PermissionModeConsent;
	mode?: string;
	via?: HerdrAllowAutoVia;
	sendError?: Error | null;
}) {
	const posts: unknown[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		if (String(input) !== "/api/permission-mode-consent") throw new Error(`unexpected fetch ${String(input)}`);
		if (init?.method === "POST") {
			posts.push(JSON.parse(String(init.body)));
			return Promise.resolve(Response.json({...consent, autoConsented: true}));
		}
		return Promise.resolve(Response.json(consent));
	});
	const input = {
		workspace: "/w",
		mode,
		availableModes: ["default", "acceptEdits", "plan", "auto"],
		sendAllowAuto: vi.fn<AllowAndSwitchToAutoInput["sendAllowAuto"]>(async () =>
			sendError === null ? Promise.resolve(via) : Promise.reject(sendError),
		),
		answerAllow: vi.fn<AllowAndSwitchToAutoInput["answerAllow"]>(async () => {}),
		expectMode: vi.fn<AllowAndSwitchToAutoInput["expectMode"]>(),
		toast: vi.fn<AllowAndSwitchToAutoInput["toast"]>(),
	} satisfies AllowAndSwitchToAutoInput;
	const outcome: {settled: "resolved" | "rejected" | null; error: unknown} = {settled: null, error: null};
	function Harness() {
		const {onAllowAndSwitch, gate} = useAllowAndSwitchToAuto(input);
		return (
			<>
				<button
					type="button"
					onClick={() => {
						onAllowAndSwitch().then(
							() => {
								outcome.settled = "resolved";
							},
							(error: unknown) => {
								outcome.settled = "rejected";
								outcome.error = error;
							},
						);
					}}
				>
					Switch
				</button>
				{gate}
			</>
		);
	}
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	render(
		<QueryClientProvider client={queryClient}>
			<Harness />
		</QueryClientProvider>,
	);
	return {input, outcome, posts};
}

function calls(input: ReturnType<typeof setup>["input"]) {
	return {
		sends: [...input.sendAllowAuto.mock.calls],
		allows: input.answerAllow.mock.calls.length,
		expected: [...input.expectMode.mock.calls],
		toasts: [...input.toast.mock.calls],
	};
}

describe("useAllowAndSwitchToAuto", () => {
	it("allows and switches at once when Auto is the default, and shows Auto until the hook confirms", async () => {
		const {input, outcome} = setup({consent: AUTO_DEFAULT});
		fireEvent.click(screen.getByRole("button", {name: "Switch"}));
		await waitFor(() => {
			expect(outcome.settled).toBe("resolved");
		});
		expect({...calls(input), dialog: screen.queryByRole("alertdialog")}).toStrictEqual({
			sends: [[3]],
			allows: 0,
			expected: [["auto"]],
			toasts: [],
			dialog: null,
		});
	});

	it("sends no shift+tab count from a mode shift+tab can't step from", async () => {
		const {input, outcome} = setup({consent: AUTO_DEFAULT, mode: "dontAsk"});
		fireEvent.click(screen.getByRole("button", {name: "Switch"}));
		await waitFor(() => {
			expect(outcome.settled).toBe("resolved");
		});
		expect(input.sendAllowAuto.mock.calls).toStrictEqual([[null]]);
	});

	it("toasts the mode failure when only the allow went through", async () => {
		const {input, outcome} = setup({consent: AUTO_DEFAULT, via: "none"});
		fireEvent.click(screen.getByRole("button", {name: "Switch"}));
		await waitFor(() => {
			expect(outcome.settled).toBe("resolved");
		});
		expect(calls(input)).toStrictEqual({
			sends: [[3]],
			allows: 0,
			expected: [],
			toasts: [[{kind: "error", message: "Mode change couldn’t be applied. You can try again."}]],
		});
	});

	it("asks for consent first, then switches on Enable auto mode", async () => {
		const {input, outcome, posts} = setup({consent: NOT_CONSENTED});
		fireEvent.click(screen.getByRole("button", {name: "Switch"}));
		const dialog = await screen.findByRole("alertdialog");
		const title = within(dialog).getByRole("heading").textContent;
		const before = calls(input);
		fireEvent.click(within(dialog).getByRole("button", {name: "Enable auto mode"}));
		await waitFor(() => {
			expect(outcome.settled).toBe("resolved");
		});
		expect({title, before, after: calls(input), posts}).toStrictEqual({
			title: "Enable auto mode?",
			before: {sends: [], allows: 0, expected: [], toasts: []},
			after: {sends: [[3]], allows: 0, expected: [["auto"]], toasts: []},
			posts: [{mode: "auto", workspace: "/w"}],
		});
	});

	it("still allows once when the consent dialog is cancelled, as upstream", async () => {
		const {input, outcome, posts} = setup({consent: NOT_CONSENTED});
		fireEvent.click(screen.getByRole("button", {name: "Switch"}));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(within(dialog).getByRole("button", {name: "Cancel"}));
		await waitFor(() => {
			expect(outcome.settled).toBe("resolved");
		});
		expect({...calls(input), posts}).toStrictEqual({
			sends: [],
			allows: 1,
			expected: [],
			toasts: [],
			posts: [],
		});
	});

	it("rejects when the pane refuses, so the card comes back with the error", async () => {
		const refusal = new Error("The terminal’s permission dialog doesn’t match this card");
		const {input, outcome} = setup({consent: AUTO_DEFAULT, sendError: refusal});
		fireEvent.click(screen.getByRole("button", {name: "Switch"}));
		await waitFor(() => {
			expect(outcome.settled).toBe("rejected");
		});
		expect({...calls(input), error: outcome.error}).toStrictEqual({
			sends: [[3]],
			allows: 0,
			expected: [],
			toasts: [],
			error: refusal,
		});
	});
});
