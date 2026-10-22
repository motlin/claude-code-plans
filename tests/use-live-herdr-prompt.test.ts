// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {describe, expect, it, vi} from "vite-plus/test";
import {useLiveHerdrPrompt} from "../src/components/use-live-herdr-prompt";
import {type SessionLine, processTranscript} from "../src/lib/transcript";

const PENDING = {error: "", isPending: true, prompt: "Fix Alice's test"};
const CLEARED = {error: "", isPending: false, prompt: ""};

const assistantRecord = (text: string) => ({
	type: "assistant",
	uuid: "a-1",
	timestamp: "1999-12-31T00:00:05Z",
	sessionId: "s-1",
	message: {role: "assistant", content: [{type: "text", text}]},
});

const userRecord = (text: string) => ({
	type: "user",
	uuid: "u-1",
	timestamp: "1999-12-31T00:00:06Z",
	sessionId: "s-1",
	message: {role: "user", content: text},
});

const enqueueRecord = (content: string) => ({
	type: "queue-operation",
	operation: "enqueue",
	timestamp: "1999-12-31T00:00:07Z",
	sessionId: "s-1",
	content,
});

const absorbedRecords = (prompt: string) => [
	{
		type: "queue-operation",
		operation: "remove",
		timestamp: "1999-12-31T00:00:08Z",
		sessionId: "s-1",
		content: prompt,
		reason: "absorbed_mid_turn",
		commandUuid: "cmd-1",
		deliveryId: "d-1",
	},
	{
		type: "attachment",
		uuid: "att-q",
		timestamp: "1999-12-31T00:00:09Z",
		sessionId: "s-1",
		attachment: {
			type: "queued_command",
			commandMode: "prompt",
			prompt,
			source_uuid: "cmd-1",
			origin: {kind: "human"},
			timestamp: "1999-12-31T00:00:01Z",
		},
	},
];

/** Lines a transcript window starting at record `startIndex` produces. */
const linesOf = (records: unknown[], startIndex: number) => processTranscript(records, startIndex).lines;

async function sentAt(recordCount: number, lines: SessionLine[] = []) {
	const postPrompt = vi.fn<(sessionId: string, prompt: string) => Promise<void>>().mockResolvedValue(undefined);
	const hook = renderHook(({count, current}) => useLiveHerdrPrompt("session-alice", count, current, postPrompt), {
		initialProps: {count: recordCount, current: lines},
	});
	await act(async () => {
		await hook.result.current.send("Fix Alice's test");
	});
	return hook;
}

describe("useLiveHerdrPrompt clears only on its own echo", () => {
	it("keeps the prompt when an unrelated assistant record lands", async () => {
		const {result, rerender} = await sentAt(100);

		rerender({count: 101, current: linesOf([assistantRecord("Still working")], 100)});

		expect(result.current.state).toStrictEqual(PENDING);
	});

	it("clears when a queued-prompt line with the same text appears", async () => {
		const {result, rerender} = await sentAt(100);

		rerender({count: 101, current: linesOf([enqueueRecord("  Fix Alice's test\n")], 100)});

		expect(result.current.state).toStrictEqual(CLEARED);
	});

	it("clears when a user record with the same text appears", async () => {
		const {result, rerender} = await sentAt(100);

		rerender({
			count: 102,
			current: linesOf([assistantRecord("Done"), userRecord("Fix Alice's test")], 100),
		});

		expect(result.current.state).toStrictEqual(CLEARED);
	});

	it("clears when the prompt is absorbed mid-turn as a human queued command", async () => {
		const {result, rerender} = await sentAt(100);

		rerender({count: 102, current: linesOf(absorbedRecords("Fix Alice's test"), 100)});

		expect(result.current.state).toStrictEqual(CLEARED);
	});

	it("ignores a matching user record from before the send", async () => {
		const earlier = linesOf([userRecord("Fix Alice's test")], 99);
		const {result, rerender} = await sentAt(100, earlier);

		rerender({count: 101, current: [...earlier, ...linesOf([assistantRecord("Working")], 100)]});

		expect(result.current.state).toStrictEqual(PENDING);
	});

	it("keeps the prompt when a user record with different text lands", async () => {
		const {result, rerender} = await sentAt(100);

		rerender({count: 101, current: linesOf([userRecord("Fix Bob's test")], 100)});

		expect(result.current.state).toStrictEqual(PENDING);
	});
});
