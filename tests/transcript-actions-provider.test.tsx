// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ChapterChips} from "../src/components/chapter-chips";
import {AssistantMessageActions, UserMessageActions} from "../src/components/message-actions";
import {ToastProvider} from "../src/components/toast";
import {TranscriptActionsProvider} from "../src/components/transcript-actions-provider";
import {readChapters} from "../src/lib/chapter-store";
import {processTranscript} from "../src/lib/transcript";
import {installLocalStorage} from "./fake-storage";

const SESSION_ID = "session-alice";

const {lines} = processTranscript([
	{type: "user", uuid: "prompt-1", message: {role: "user", content: "Set up the repo"}},
	{
		type: "assistant",
		uuid: "reply-1",
		parentUuid: "prompt-1",
		message: {role: "assistant", content: [{type: "text", text: "The repo is ready."}]},
	},
	{type: "user", uuid: "prompt-2", parentUuid: "reply-1", message: {role: "user", content: "Now add tests"}},
]);

interface FetchCall {
	url: string;
	method: string;
	body: unknown;
}

function stubFetch(responses: unknown[]): FetchCall[] {
	const calls: FetchCall[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({
				url,
				method: init?.method ?? "GET",
				body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
			});
			if (responses.length === 0) throw new Error(`Unexpected fetch ${url}`);
			return new Response(JSON.stringify(responses.shift()), {
				status: 200,
				headers: {"Content-Type": "application/json"},
			});
		}),
	);
	return calls;
}

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function renderTranscript(fork: ((target: {sessionId: string; atMessage: string}) => void) | undefined) {
	return render(
		<ToastProvider>
			<TranscriptActionsProvider sessionId={SESSION_ID} lines={lines} fork={fork}>
				<ChapterChips sessionId={SESSION_ID} onJump={() => {}} />
				<div data-turn="reply-1">
					<AssistantMessageActions
						message={{sessionId: SESSION_ID, uuid: "reply-1"}}
						text="The repo is ready."
						details={[]}
					/>
				</div>
				<div data-turn="prompt-2">
					<UserMessageActions
						message={{sessionId: SESSION_ID, uuid: "prompt-2"}}
						text="Now add tests"
						details={[]}
					/>
				</div>
			</TranscriptActionsProvider>
		</ToastProvider>,
	).container;
}

function turnButton(container: HTMLElement, turn: string, label: string): HTMLButtonElement {
	return container.querySelector<HTMLButtonElement>(`[data-turn="${turn}"] button[aria-label="${label}"]`)!;
}

describe("TranscriptActionsProvider", () => {
	it("forks an assistant turn at itself and a prompt at the turn before it", () => {
		const fork = vi.fn();
		const container = renderTranscript(fork);

		fireEvent.click(turnButton(container, "reply-1", "Fork from here"));
		fireEvent.click(turnButton(container, "prompt-2", "Fork from here"));

		expect(fork.mock.calls).toStrictEqual([
			[{sessionId: SESSION_ID, atMessage: "reply-1"}],
			[{sessionId: SESSION_ID, atMessage: "reply-1"}],
		]);
	});

	it("leaves Fork disabled when the session has no directory to fork in", () => {
		const container = renderTranscript(undefined);

		expect(turnButton(container, "reply-1", "Fork from here").disabled).toBe(true);
	});

	it("pins a turn as a chapter that the chapter chips list, and unpins it on a second press", () => {
		const container = renderTranscript(undefined);

		fireEvent.click(turnButton(container, "reply-1", "Pin as chapter"));
		const pinned = {
			stored: readChapters(SESSION_ID),
			chips: screen.getAllByRole("button", {name: /^Jump to chapter/}).map((chip) => chip.textContent),
			pressed: turnButton(container, "reply-1", "Pin as chapter").getAttribute("aria-pressed"),
		};
		fireEvent.click(turnButton(container, "reply-1", "Pin as chapter"));

		expect({pinned, after: readChapters(SESSION_ID)}).toStrictEqual({
			pinned: {
				stored: [{uuid: "reply-1", label: "The repo is ready.", recordIndex: 1}],
				chips: ["The repo is ready."],
				pressed: "true",
			},
			after: [],
		});
	});

	it("rewinds a prompt through the turn Undo confirm", async () => {
		const calls = stubFetch([
			{files: [{path: "/repo/src/test.ts", status: "added", state: "ready"}]},
			{reverted: ["/repo/src/test.ts"]},
		]);
		const container = renderTranscript(undefined);

		fireEvent.click(turnButton(container, "prompt-2", "Rewind to here"));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(within(dialog).getByRole("button", {name: "Undo changes"}));
		const done = await screen.findByText("Reverted 1 file");

		expect({done: done.textContent, calls}).toStrictEqual({
			done: "Reverted 1 file",
			calls: [
				{url: `/api/sessions/${SESSION_ID}/turn-undo?turn=prompt-2`, method: "GET", body: null},
				{url: `/api/sessions/${SESSION_ID}/turn-undo`, method: "POST", body: {turn: "prompt-2", confirm: true}},
			],
		});
	});

	it("refuses a rewind whose files changed since the turn, without a dialog", async () => {
		stubFetch([{files: [{path: "/repo/src/test.ts", status: "modified", state: "conflict"}]}]);
		const container = renderTranscript(undefined);

		fireEvent.click(turnButton(container, "prompt-2", "Rewind to here"));
		const refusal = await screen.findByText("Can't undo: test.ts changed since this turn.");

		expect({refusal: refusal.textContent, dialog: screen.queryByRole("alertdialog")}).toStrictEqual({
			refusal: "Can't undo: test.ts changed since this turn.",
			dialog: null,
		});
	});
});
