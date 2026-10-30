// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ApiRequestDisclosure} from "../src/components/api-request-disclosure";
import {sessionQueryKeys} from "../src/lib/api/sessions";
import type {ApiRequestLog} from "../src/lib/api-request-log";
import type {ApiRequestMessages} from "../src/lib/api-request-messages";

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
		withArtifacts: {
			id: "withArtifacts",
			timestamp: "2000-01-01T00:00:00.000Z",
			querySource: "repl_main_thread",
			shapeHash: "missing",
			model: "claude-opus-5-5",
			betas: [],
			maxTokens: 100,
			thinking: {type: "adaptive", display: "updates"},
			effort: "high",
			artifacts: [
				{
					id: "artifact-alice-1",
					paths: [],
					lastPublish: false,
					share: {
						mode: "owner",
						role: "owner",
						isSharedLive: true,
						probed: true,
						probeFailed: false,
						probeCurrentAccount: true,
						typeLock: true,
						livePaths: ["index.html"],
						capabilities: ["db", "user"],
						grantObserved: true,
					},
				},
				{
					id: "artifact-alice-2",
					paths: ["/tmp/alice/review.html"],
					lastPublish: true,
					publishedEnv: "prod",
					share: {
						mode: "owner",
						isSharedLive: false,
						probed: true,
						probeFailed: true,
						probeCurrentAccount: false,
						typeLock: false,
						livePaths: [],
						capabilities: [],
						grantObserved: false,
					},
				},
				{id: "artifact-alice-3", paths: [], lastPublish: false, attested: "first_party_type"},
				{id: "artifact-alice-4", paths: ["/tmp/alice/other.html"], lastPublish: false},
			],
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

const MESSAGES: ApiRequestMessages = {
	found: true,
	messages: [
		{
			hash: "h-user",
			role: "user",
			blocks: [
				{type: "text", text: "I got [Image #1]"},
				{type: "image", mediaType: "image/png", data: "AAAA"},
				{
					type: "tool_result",
					toolUseId: "toolu_1",
					isError: true,
					text: "Failed.",
					images: [{mediaType: "image/jpeg", data: "BBBB"}],
				},
				{type: "tool_addition", name: "mcp__docs__guide", definition: false},
			],
		},
		{
			hash: "h-assistant",
			role: "assistant",
			blocks: [
				{type: "thinking", text: "Plan."},
				{type: "tool_use", id: "toolu_1", name: "Read", input: '{"file_path":"/a"}'},
			],
		},
	],
	missing: ["h-gone"],
};

function renderDisclosure(requestRef: string) {
	const queryClient = new QueryClient();
	queryClient.setQueryData(sessionQueryKeys.apiRequests("session-1"), LOG);
	queryClient.setQueryData(sessionQueryKeys.apiRequestMessages("session-1", "r1"), MESSAGES);
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
				"New messages",
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
				"New messages",
			].join(""),
		);
	});

	it("lists the classifier's artifact share state", () => {
		renderDisclosure("withArtifacts");
		fireEvent.click(screen.getByRole("button", {name: "Request"}));
		expect(screen.getByTestId("api-request-body").textContent).toBe(
			[
				"Opus 5.5 · high effort · adaptive thinking (updates)",
				"Max tokens100",
				"Query sourcerepl_main_thread",
				"Artifacts (4)",
				"artifact-alice-1",
				"Owner share · role Owner · shared live · type-locked · live paths: index.html · capabilities: db, user · grant observed",
				"artifact-alice-2",
				"Owner share · not shared live · share probe failed · probed as another account · published to Production · last publish · from /tmp/alice/review.html",
				"artifact-alice-3",
				"First-party type, not probed",
				"artifact-alice-4",
				"from /tmp/alice/other.html",
				"No tool list or system prompt logged for this request",
				"New messages",
			].join(""),
		);
	});

	it("shows the messages the request appended once its Messages section opens", () => {
		renderDisclosure("r1");
		fireEvent.click(screen.getByRole("button", {name: "Request"}));
		fireEvent.click(screen.getByRole("button", {name: "New messages"}));
		const messages = screen.getByTestId("api-request-messages");
		expect(messages.textContent).toBe(
			[
				"user",
				"I got [Image #1]",
				"Tool result toolu_1 (error)",
				"Failed.",
				"Added tool mcp__docs__guide (by name)",
				"assistant",
				"Thinking",
				"Plan.",
				"Tool use Read",
				'{"file_path":"/a"}',
				"1 message has no logged blob",
			].join(""),
		);
		expect([...messages.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toStrictEqual([
			"data:image/png;base64,AAAA",
			"data:image/jpeg;base64,BBBB",
		]);
		expect(screen.getAllByRole("button", {name: "Open Attached image"})).toHaveLength(2);
	});

	it("says so when the session never logged the request", () => {
		renderDisclosure("nope");
		fireEvent.click(screen.getByRole("button", {name: "Request"}));
		expect(screen.getByTestId("api-request-body").textContent).toBe("No API request logged for this turn");
	});
});
