// @vitest-environment jsdom

import {act, fireEvent, render, renderHook, screen, waitFor} from "@testing-library/react";
import {describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {useChatStream} from "../src/hooks/use-chat-stream";
import {getSessionPromptBehavior, useLiveHerdrPrompt} from "../src/components/session-page";

vi.mock("../src/components/session-chat", () => ({
	SessionChat: () => null,
}));

describe("session live input", () => {
	it("selects the live route only for a writable matching herdr pane", () => {
		const panes = [{sessionId: "session-test-100"}];

		expect([
			getSessionPromptBehavior("session-test-100", true, {panes, writesEnabled: true}),
			getSessionPromptBehavior("session-test-100", true, {panes, writesEnabled: false}),
			getSessionPromptBehavior("session-test-200", false, {panes, writesEnabled: true}),
			getSessionPromptBehavior("session-test-200", true, {panes, writesEnabled: true}),
		]).toStrictEqual([
			{
				disabled: false,
				deliveryHint: "Sends to the live terminal",
				hasLivePane: true,
				usesHerdr: true,
			},
			{
				disabled: true,
				deliveryHint: "Live terminal input is disabled",
				hasLivePane: true,
				usesHerdr: false,
			},
			{
				disabled: false,
				deliveryHint: "Starts a forked session",
				hasLivePane: false,
				usesHerdr: false,
			},
			{
				disabled: true,
				deliveryHint: "Starts a forked session",
				hasLivePane: false,
				usesHerdr: false,
			},
		]);
	});

	it("describes live delivery on Send without changing the composer's send contract", () => {
		const onSend = vi.fn<(prompt: string) => void>();

		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={onSend}
				deliveryHint="Sends to the live terminal"
			/>,
		);

		const send = screen.getByRole("button", {name: "Send"});
		expect(document.getElementById(send.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
			"Sends to the live terminal",
		);
		fireEvent.change(screen.getByRole("textbox", {name: "Prompt"}), {
			target: {value: "Continue Alice's test"},
		});
		fireEvent.click(send);
		expect(onSend.mock.calls).toStrictEqual([["Continue Alice's test", {}]]);
	});

	it("does not synchronously measure or resize the transcript textarea while typing", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		const readScrollHeight = vi.fn(() => 100);
		Object.defineProperty(textarea, "scrollHeight", {
			configurable: true,
			get: readScrollHeight,
		});

		fireEvent.input(textarea, {target: {value: "Continue Alice's test"}});

		expect({
			height: textarea.style.height,
			scrollHeightReads: readScrollHeight.mock.calls,
			value: textarea.value,
		}).toStrictEqual({
			height: "",
			scrollHeightReads: [],
			value: "Continue Alice's test",
		});
	});

	it("reports an HTTP status instead of a JSON parser error for a malformed rejection", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("Forbidden", {
				status: 403,
				headers: {"Content-Type": "application/json"},
			}),
		);
		const {result} = renderHook(() => useChatStream());

		await act(async () => {
			await result.current.send("session-test-100", "Continue Alice's test");
		});

		expect({calls: fetchMock.mock.calls, state: result.current.state}).toStrictEqual({
			calls: [
				[
					"/api/chat",
					{
						body: JSON.stringify({
							sessionId: "session-test-100",
							prompt: "Continue Alice's test",
						}),
						headers: {"Content-Type": "application/json"},
						method: "POST",
						signal: expect.any(AbortSignal),
					},
				],
			],
			state: {
				error: "Request failed (403)",
				isComplete: true,
				isStreaming: false,
				sentPrompt: "Continue Alice's test",
				text: "",
			},
		});
		fetchMock.mockRestore();
	});

	it("posts the composer launch options with a forked prompt", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Forbidden", {status: 403}));
		const {result} = renderHook(() => useChatStream());

		await act(async () => {
			await result.current.send("session-test-100", "Continue Alice's test", {
				permissionMode: "plan",
				effort: "max",
			});
		});

		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toStrictEqual({
			sessionId: "session-test-100",
			prompt: "Continue Alice's test",
			launchOptions: {permissionMode: "plan", effort: "max"},
		});
		fetchMock.mockRestore();
	});

	it("keeps a sent prompt pending until transcript delivery", async () => {
		let finishPost: (() => void) | undefined;
		const postPrompt = vi.fn<(sessionId: string, prompt: string) => Promise<void>>(
			() =>
				new Promise<void>((resolve) => {
					finishPost = resolve;
				}),
		);
		const {result, rerender} = renderHook(
			({recordCount}) => useLiveHerdrPrompt("session-test-100", recordCount, postPrompt),
			{initialProps: {recordCount: 100}},
		);

		act(() => {
			void result.current.send("Continue Alice's test");
		});
		expect(result.current.state).toStrictEqual({
			error: "",
			isPending: true,
			prompt: "Continue Alice's test",
		});

		await act(async () => {
			if (!finishPost) throw new Error("Expected fabricated prompt request");
			finishPost();
		});
		expect(result.current.state).toStrictEqual({
			error: "",
			isPending: true,
			prompt: "Continue Alice's test",
		});

		rerender({recordCount: 101});
		await waitFor(() => {
			expect(result.current.state).toStrictEqual({error: "", isPending: false, prompt: ""});
		});
	});

	it("reports a POST error and leaves the input out of pending state", async () => {
		const postPrompt = vi
			.fn<(sessionId: string, prompt: string) => Promise<void>>()
			.mockRejectedValue(new Error("Fabricated live prompt failure"));
		const {result} = renderHook(() => useLiveHerdrPrompt("session-test-100", 100, postPrompt));

		await act(async () => {
			await result.current.send("Continue Alice's test");
		});

		expect(result.current.state).toStrictEqual({
			error: "Fabricated live prompt failure",
			isPending: false,
			prompt: "Continue Alice's test",
		});
	});
});
