// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {useCallback} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {SendRejectedCard} from "../src/components/send-rejected-card";
import {useLiveHerdrPrompt} from "../src/components/use-live-herdr-prompt";
import {useSendRejectionActions} from "../src/components/use-send-rejection-actions";
import {useComposerQueue} from "../src/hooks/use-composer-queue";
import {HerdrRequestError} from "../src/lib/api/herdr";
import {clearComposerQueues, dispatchComposerQueue} from "../src/lib/composer-queue";
import {refillComposer} from "../src/lib/context-attach";

afterEach(() => {
	cleanup();
	localStorage.clear();
	clearComposerQueues();
});

type PostPrompt = (sessionId: string, prompt: string, options: {midTurn?: true}) => Promise<void>;

const boom = () => new HerdrRequestError("boom", 502, "herdr_error");

function Harness({postPrompt, busy = false}: {postPrompt: PostPrompt; busy?: boolean}) {
	const refill = useCallback((prompt: string) => refillComposer("s1", prompt), []);
	const live = useLiveHerdrPrompt("s1", 0, [], postPrompt, refill);
	const {retryRejection, dismissRejection} = useSendRejectionActions("s1", live.state.rejection, live.clearRejection);
	useComposerQueue({sessionId: "s1", busy, deliver: live.send, interrupt: async () => {}});
	return (
		<>
			{live.state.rejection !== null && (
				<SendRejectedCard
					rejection={live.state.rejection}
					onRetry={retryRejection}
					onDismiss={dismissRejection}
				/>
			)}
			<Composer variant="session" draftKey="s1" onSend={(prompt) => void live.send(prompt)} />
		</>
	);
}

const textarea = () => screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
const card = () => screen.queryByTestId("send-rejected-card");

async function sendAndReject(postPrompt: PostPrompt) {
	render(<Harness postPrompt={postPrompt} />);
	fireEvent.change(textarea(), {target: {value: "hi"}});
	fireEvent.keyDown(textarea(), {key: "Enter"});
	await waitFor(() => {
		expect(card()).not.toBeNull();
	});
}

describe("send-rejected Try again / Dismiss", () => {
	it("resends an unchanged prompt, unmounting the card before the resend settles", async () => {
		let settle: () => void = () => {};
		const postPrompt = vi
			.fn<PostPrompt>()
			.mockRejectedValueOnce(boom())
			.mockImplementationOnce(
				async () =>
					new Promise<void>((resolve) => {
						settle = resolve;
					}),
			);
		await sendAndReject(postPrompt);

		fireEvent.click(screen.getByRole("button", {name: "Try again"}));

		expect({
			calls: postPrompt.mock.calls,
			card: card(),
			value: textarea().value,
		}).toStrictEqual({
			calls: [
				["s1", "hi", {}],
				["s1", "hi", {}],
			],
			card: null,
			value: "",
		});
		settle();
		await act(async () => Promise.resolve());
	});

	it("focuses an edited prompt instead of resending, and removes the card", async () => {
		const postPrompt = vi.fn<PostPrompt>().mockRejectedValueOnce(boom());
		await sendAndReject(postPrompt);
		fireEvent.change(textarea(), {target: {value: "hi edited"}});
		textarea().blur();

		fireEvent.click(screen.getByRole("button", {name: "Try again"}));

		expect({
			calls: postPrompt.mock.calls.length,
			card: card(),
			value: textarea().value,
			focused: document.activeElement === textarea(),
		}).toStrictEqual({calls: 1, card: null, value: "hi edited", focused: true});
	});

	it("dismisses the card, keeping the refilled text and focusing the composer", async () => {
		const postPrompt = vi.fn<PostPrompt>().mockRejectedValueOnce(boom());
		await sendAndReject(postPrompt);
		textarea().blur();

		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));

		expect({
			calls: postPrompt.mock.calls.length,
			card: card(),
			value: textarea().value,
			focused: document.activeElement === textarea(),
		}).toStrictEqual({calls: 1, card: null, value: "hi", focused: true});
	});

	it("brings the card back and refills the composer when the resend fails too", async () => {
		const postPrompt = vi.fn<PostPrompt>().mockRejectedValueOnce(boom()).mockRejectedValueOnce(boom());
		await sendAndReject(postPrompt);

		fireEvent.click(screen.getByRole("button", {name: "Try again"}));
		await waitFor(() => {
			expect(card()).not.toBeNull();
		});

		expect({calls: postPrompt.mock.calls.length, value: textarea().value}).toStrictEqual({
			calls: 2,
			value: "hi",
		});
	});

	it("refills the composer with a queued prompt whose delivery fails", async () => {
		const postPrompt = vi.fn<PostPrompt>().mockRejectedValueOnce(boom());
		const {rerender} = render(<Harness postPrompt={postPrompt} busy />);
		act(() => {
			dispatchComposerQueue("s1", {type: "enqueue", item: {id: "q1", text: "Alice's queued prompt"}});
		});

		rerender(<Harness postPrompt={postPrompt} busy={false} />);
		await waitFor(() => {
			expect(card()).not.toBeNull();
		});

		expect({calls: postPrompt.mock.calls, value: textarea().value}).toStrictEqual({
			calls: [["s1", "Alice's queued prompt", {}]],
			value: "Alice's queued prompt",
		});
	});

	it("records the rejected prompt as the draft's failedSend", async () => {
		await sendAndReject(vi.fn<PostPrompt>().mockRejectedValueOnce(boom()));

		await waitFor(() => {
			expect(localStorage.getItem("ccp-composer-draft:s1")).toBe(JSON.stringify({text: "hi", failedSend: "hi"}));
		});
	});
});

describe("send-rejected card after a reload", () => {
	it("comes back with the fallback message while the draft still equals failedSend", async () => {
		localStorage.setItem("ccp-composer-draft:s1", JSON.stringify({text: "hi", failedSend: "hi"}));

		render(<Harness postPrompt={vi.fn<PostPrompt>()} />);

		await waitFor(() => {
			expect(card()).not.toBeNull();
		});
		expect({value: textarea().value, message: screen.getByText("Send failed").tagName}).toStrictEqual({
			value: "hi",
			message: "SPAN",
		});
	});

	it("stays away once the draft was edited after the failure", async () => {
		localStorage.setItem("ccp-composer-draft:s1", JSON.stringify({text: "hi edited", failedSend: "hi"}));

		render(<Harness postPrompt={vi.fn<PostPrompt>()} />);

		await waitFor(() => {
			expect(textarea().value).toBe("hi edited");
		});
		expect(card()).toBeNull();
	});
});
