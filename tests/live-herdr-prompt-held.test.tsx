// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {useLiveHerdrPrompt} from "../src/components/use-live-herdr-prompt";
import {type DeliveryResult} from "../src/hooks/use-composer-queue";
import {HerdrRequestError} from "../src/lib/api/herdr";
import {registerComposer} from "../src/lib/context-attach";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

type PostPrompt = (sessionId: string, prompt: string, options: {midTurn?: true}) => Promise<void>;

function renderHeld(postPrompt: PostPrompt, onRejected = vi.fn<(prompt: string) => void>()) {
	return renderHook(
		({hasLivePane}: {hasLivePane: boolean}) =>
			useLiveHerdrPrompt("session-alice", 100, [], postPrompt, onRejected, hasLivePane),
		{initialProps: {hasLivePane: false}},
	);
}

describe("useLiveHerdrPrompt held for the terminal", () => {
	it.each(["session-not-found", "pane-not-found"])(
		"holds a prompt rejected with %s instead of failing it",
		async (code) => {
			const postPrompt = vi.fn<PostPrompt>().mockRejectedValue(new HerdrRequestError("no live pane", 502, code));
			const onRejected = vi.fn<(prompt: string) => void>();
			const {result} = renderHeld(postPrompt, onRejected);

			let delivery: DeliveryResult | undefined;
			await act(async () => {
				delivery = await result.current.send("Alice's prompt");
			});

			expect({delivery, state: result.current.state, refilled: onRejected.mock.calls}).toStrictEqual({
				delivery: "failed",
				state: {phase: "held", isPending: true, prompt: "Alice's prompt", rejection: null},
				refilled: [],
			});
		},
	);

	it("fails a 502 with another code rather than holding it", async () => {
		const postPrompt = vi
			.fn<PostPrompt>()
			.mockRejectedValue(new HerdrRequestError("herdr refused", 502, "agent_prompt_stalled"));
		const {result} = renderHeld(postPrompt);

		await act(async () => {
			await result.current.send("Alice's prompt");
		});

		expect(result.current.state).toStrictEqual({
			phase: "idle",
			isPending: false,
			prompt: "",
			rejection: {prompt: "Alice's prompt", message: "herdr refused", nonResendable: false},
		});
	});

	it("delivers the held prompt exactly once when the session gains a live pane", async () => {
		const postPrompt = vi
			.fn<PostPrompt>()
			.mockRejectedValueOnce(new HerdrRequestError("no live pane", 502, "session-not-found"))
			.mockResolvedValue(undefined);
		const {result, rerender} = renderHeld(postPrompt);

		await act(async () => {
			await result.current.send("Alice's prompt");
		});
		act(() => {
			rerender({hasLivePane: true});
		});
		// Let the auto-delivered POST settle before the next render.
		await act(async () => {
			await Promise.resolve();
		});
		act(() => {
			rerender({hasLivePane: true});
		});

		expect({calls: postPrompt.mock.calls, state: result.current.state}).toStrictEqual({
			calls: [
				["session-alice", "Alice's prompt", {}],
				["session-alice", "Alice's prompt", {}],
			],
			state: {phase: "sent", isPending: true, prompt: "Alice's prompt", rejection: null},
		});
	});

	it("withdraw drops the held row and takes the prompt back into the composer", async () => {
		const postPrompt = vi
			.fn<PostPrompt>()
			.mockRejectedValue(new HerdrRequestError("no live pane", 502, "pane-not-found"));
		const takeBack = vi.fn<(text: string) => void>();
		const stop = registerComposer("session-alice", {insertText: () => {}, focus: () => {}, takeBack});
		const {result} = renderHeld(postPrompt);

		await act(async () => {
			await result.current.send("Alice's prompt");
		});
		act(() => {
			result.current.withdraw();
		});
		stop();

		expect({takeBack: takeBack.mock.calls, state: result.current.state}).toStrictEqual({
			takeBack: [["Alice's prompt"]],
			state: {phase: "idle", isPending: false, prompt: "", rejection: null},
		});
	});
});
