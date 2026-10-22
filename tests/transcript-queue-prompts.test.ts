import {describe, it, expect} from "vite-plus/test";
import {isHumanQueuedContent, processTranscript} from "../src/lib/transcript";

const queueOp = (operation: string, timestamp: string, content?: string, extra: Record<string, unknown> = {}) => ({
	type: "queue-operation",
	operation,
	timestamp,
	sessionId: "s-1",
	...(content === undefined ? {} : {content}),
	...extra,
});

const userRecord = (text: string) => ({
	type: "user",
	uuid: "u-1",
	timestamp: "1999-12-31T00:00:09Z",
	sessionId: "s-1",
	message: {role: "user", content: text},
});

const queuedPrompts = (records: unknown[]) =>
	processTranscript(records).lines.filter((line) => line.type === "queued-prompt");

describe("queued-prompt lines for human enqueues", () => {
	it("draws a waiting enqueue as a queued-prompt line with the enqueue timestamp", () => {
		expect(processTranscript([queueOp("enqueue", "1999-12-31T00:00:01Z", "hi")]).lines).toStrictEqual([
			{type: "queued-prompt", content: "hi", timestamp: "1999-12-31T00:00:01Z", lineIndex: 0},
		]);
	});

	it("drops the line once the prompt is absorbed mid-turn", () => {
		const records = [
			queueOp("enqueue", "1999-12-31T00:00:01Z", "hi"),
			queueOp("remove", "1999-12-31T00:00:02Z", "hi", {
				reason: "absorbed_mid_turn",
				commandUuid: "cmd-1",
				deliveryId: "d-1",
			}),
			{
				type: "attachment",
				uuid: "att-q",
				timestamp: "1999-12-31T00:00:03Z",
				sessionId: "s-1",
				attachment: {type: "queued_command", prompt: "hi", source_uuid: "cmd-1"},
			},
		];
		expect(queuedPrompts(records)).toStrictEqual([]);
	});

	it("drops the line once the prompt is dequeued and sent", () => {
		const records = [
			queueOp("enqueue", "1999-12-31T00:00:01Z", "hi"),
			queueOp("dequeue", "1999-12-31T00:00:02Z"),
			userRecord("hi"),
		];
		expect(queuedPrompts(records)).toStrictEqual([]);
	});

	it("drops the line when a reasonless removal takes the prompt", () => {
		const records = [
			queueOp("enqueue", "1999-12-31T00:00:01Z", "hi"),
			queueOp("remove", "1999-12-31T00:00:02Z", "hi"),
		];
		expect(queuedPrompts(records)).toStrictEqual([]);
	});

	it("draws no line for a CLI notice about stopped background agents", () => {
		expect(
			processTranscript([
				queueOp("enqueue", "1999-12-31T00:00:01Z", 'Background agent "x" was stopped by the user.'),
			]).lines,
		).toStrictEqual([]);
	});

	it("takes the prompt ahead of an earlier task notification, which stays undelivered", () => {
		const notification = "<task-notification>T</task-notification>";
		const records = [
			queueOp("enqueue", "1999-12-31T00:00:01Z", notification),
			queueOp("enqueue", "1999-12-31T00:00:02Z", "hi"),
			queueOp("dequeue", "1999-12-31T00:00:03Z"),
		];
		expect(processTranscript(records).lines).toStrictEqual([
			{
				type: "queued-task-notification",
				content: notification,
				timestamp: "1999-12-31T00:00:01Z",
				lineIndex: 0,
			},
		]);
	});

	it("draws stacked waiting prompts in enqueue order", () => {
		const records = [
			queueOp("enqueue", "1999-12-31T00:00:01Z", "a"),
			queueOp("enqueue", "1999-12-31T00:00:02Z", "b"),
		];
		expect(processTranscript(records).lines).toStrictEqual([
			{type: "queued-prompt", content: "a", timestamp: "1999-12-31T00:00:01Z", lineIndex: 0},
			{type: "queued-prompt", content: "b", timestamp: "1999-12-31T00:00:02Z", lineIndex: 1},
		]);
	});

	it("drops every waiting prompt on popAll", () => {
		const records = [
			queueOp("enqueue", "1999-12-31T00:00:01Z", "a"),
			queueOp("enqueue", "1999-12-31T00:00:02Z", "b"),
			queueOp("popAll", "1999-12-31T00:00:03Z"),
		];
		expect(processTranscript(records).lines).toStrictEqual([]);
	});
});

describe("isHumanQueuedContent", () => {
	it.each([
		["/compact", true],
		["!ls", true],
		["<pasted_content>x</pasted_content> look", true],
		["[Image #3] what is this", true],
		["fix it", true],
		["", false],
		["<task-notification>T</task-notification>", false],
		['<agent-message from="a">hi</agent-message>', false],
		["<cross-session-message from=x>hi</cross-session-message>", false],
		['Background agent "x" was stopped by the user.', false],
		['Background agent "x" was stopped\nby the user.', false],
		["3 background agents were stopped by the user.", false],
		["[Cross-session delivery notice] something", false],
		["The person enabled mod hot-reload for this session.", false],
	])("%j → %s", (content, expected) => {
		expect(isHumanQueuedContent(content)).toBe(expected);
	});

	it("is false for undefined content", () => {
		expect(isHumanQueuedContent(undefined)).toBe(false);
	});
});
