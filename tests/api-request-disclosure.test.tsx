// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ApiRequestDisclosure} from "../src/components/api-request-disclosure";
import {sessionQueryKeys} from "../src/lib/api/sessions";
import type {ApiRequestLog} from "../src/lib/api-request-log";

afterEach(cleanup);

const LOG: ApiRequestLog = {
	requests: {
		r1: {
			id: "r1",
			timestamp: "2000-01-01T00:00:00.000Z",
			querySource: "repl_main_thread",
			shapeHash: "s1",
			model: "claude-opus-5-5",
			betas: ["beta-one", "beta-two"],
			maxTokens: 128000,
			thinking: {type: "adaptive", display: "updates"},
			effort: "medium",
			permissionMode: "auto",
			toolChanges: {added: ["Write"], removed: ["Bash"]},
		},
		orphan: {
			id: "orphan",
			timestamp: "2000-01-01T00:00:00.000Z",
			querySource: "repl_main_thread",
			shapeHash: "missing",
			model: "claude-opus-5-5",
			betas: [],
			maxTokens: 100,
			thinking: {type: "adaptive", display: "updates"},
			effort: "high",
		},
	},
	shapes: {s1: {shapeHash: "s1", system: ["You are a test."], tools: ["Read", "Write"]}},
};

function renderDisclosure(requestRef: string) {
	const queryClient = new QueryClient();
	queryClient.setQueryData(sessionQueryKeys.apiRequests("session-1"), LOG);
	render(
		<QueryClientProvider client={queryClient}>
			<ApiRequestDisclosure sessionId="session-1" requestRef={requestRef} />
		</QueryClientProvider>,
	);
}

describe("ApiRequestDisclosure", () => {
	it("stays collapsed until opened", () => {
		renderDisclosure("r1");
		const button = screen.getByRole("button", {name: "Request"});
		expect(button.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("Opus 5.5 · medium effort · adaptive thinking (updates)")).toBeNull();
	});

	it("shows the request's params, tools, tool changes and system prompt once opened", () => {
		renderDisclosure("r1");
		fireEvent.click(screen.getByRole("button", {name: "Request"}));
		const body = screen.getByTestId("api-request-body");
		expect(body.textContent).toBe(
			[
				"Opus 5.5 · medium effort · adaptive thinking (updates)",
				"Max tokens128,000",
				"Permission modeauto",
				"Query sourcerepl_main_thread",
				"Betasbeta-one, beta-two",
				"Tools changed+Write −Bash",
				"Tools (2)Read, Write",
				"System prompt (1 block)",
			].join(""),
		);
		fireEvent.click(screen.getByRole("button", {name: "System prompt (1 block)"}));
		expect(screen.getByText("You are a test.")).toBeTruthy();
	});

	it("says so when the request's shape was never logged", () => {
		renderDisclosure("orphan");
		fireEvent.click(screen.getByRole("button", {name: "Request"}));
		expect(screen.getByTestId("api-request-body").textContent).toBe(
			[
				"Opus 5.5 · high effort · adaptive thinking (updates)",
				"Max tokens100",
				"Query sourcerepl_main_thread",
				"No tool list or system prompt logged for this request",
			].join(""),
		);
	});

	it("says so when the session never logged the request", () => {
		renderDisclosure("nope");
		fireEvent.click(screen.getByRole("button", {name: "Request"}));
		expect(screen.getByTestId("api-request-body").textContent).toBe("No API request logged for this turn");
	});
});
