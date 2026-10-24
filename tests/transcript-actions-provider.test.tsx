// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
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

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function renderTranscript(
	fork: ((target: {sessionId: string; atMessage: string}) => void) | undefined,
	working = false,
	archived = false,
	rewind: (uuid: string) => void = () => {},
) {
	return render(
		<ToastProvider>
			<TranscriptActionsProvider
				sessionId={SESSION_ID}
				lines={lines}
				fork={fork}
				rewind={rewind}
				working={working}
				archived={archived}
			>
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
		const fork = vi.fn<(target: {sessionId: string; atMessage: string}) => void>();
		const container = renderTranscript(fork);

		fireEvent.click(turnButton(container, "reply-1", "Fork from here"));
		fireEvent.click(turnButton(container, "prompt-2", "Fork from here"));

		expect(fork.mock.calls).toStrictEqual([
			[{sessionId: SESSION_ID, atMessage: "reply-1"}],
			[{sessionId: SESSION_ID, atMessage: "reply-1"}],
		]);
	});

	it("disables Fork with a reason when the session has no directory to fork in", () => {
		const container = renderTranscript(undefined);
		const fork = turnButton(container, "reply-1", "Fork from here");
		const describedBy = fork.closest("[data-cds-disabled-reason-wrapper]")?.getAttribute("aria-describedby");

		expect({
			disabled: fork.disabled,
			reason:
				describedBy === undefined || describedBy === null
					? null
					: document.getElementById(describedBy)?.textContent,
		}).toStrictEqual({disabled: true, reason: "Session directory is unknown"});
	});

	it("disables Rewind with upstream's reason while Claude is working", () => {
		const container = renderTranscript(undefined, true);
		const rewind = turnButton(container, "prompt-2", "Rewind to here");
		const describedBy = rewind.closest("[data-cds-disabled-reason-wrapper]")?.getAttribute("aria-describedby");

		expect({
			disabled: rewind.disabled,
			reason:
				describedBy === undefined || describedBy === null
					? null
					: document.getElementById(describedBy)?.textContent,
		}).toStrictEqual({disabled: true, reason: "Rewind is unavailable while Claude is working"});
	});

	it("drops Rewind from an archived session's user toolbar, like upstream's showRewind false", () => {
		const container = renderTranscript(vi.fn(), false, true);
		const labels = [...container.querySelectorAll('[data-turn="prompt-2"] button[aria-label]')].map((button) =>
			button.getAttribute("aria-label"),
		);

		expect(labels).toStrictEqual(["Show message actions for You said: Now add tests", "Copy", "Fork from here"]);
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

	it("hands a prompt's Rewind to the session's rewind request", () => {
		const rewind = vi.fn<(uuid: string) => void>();
		const container = renderTranscript(undefined, false, false, rewind);

		fireEvent.click(turnButton(container, "prompt-2", "Rewind to here"));

		expect(rewind.mock.calls).toStrictEqual([["prompt-2"]]);
	});
});
