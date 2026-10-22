import {describe, expect, it} from "vite-plus/test";

import {
	composerPendingGate,
	composerSendPlan,
	gateHoldsQueue,
	QUESTION_DISMISSED_BY_MESSAGE,
	type ComposerPendingGate,
} from "../src/lib/composer-pending-gate";
import type {PendingQuestionItem} from "../src/lib/hook-events";

const COLOR: PendingQuestionItem = {
	question: "Which color should Alice's button be?",
	options: [{label: "Red"}, {label: "Blue"}],
};
const TOPPINGS: PendingQuestionItem = {
	question: "Which toppings does Bob want?",
	options: [{label: "Cheese"}, {label: "Olives"}],
	multiSelect: true,
};

describe("composerPendingGate", () => {
	it("is a question when the hook reports one, answerable in the live pane", () => {
		expect(
			composerPendingGate({
				hookQuestion: {toolUseId: "toolu_alice", questions: [COLOR]},
				transcriptQuestion: true,
				awaitingPermission: false,
			}),
		).toStrictEqual({kind: "question", toolUseId: "toolu_alice", questions: [COLOR]});
	});

	it("holds without dismissing a question the transcript shows but no hook reported", () => {
		expect(
			composerPendingGate({hookQuestion: null, transcriptQuestion: true, awaitingPermission: false}),
		).toStrictEqual({kind: "held-question"});
	});

	it("is a permission while a tool permission prompt waits", () => {
		expect(
			composerPendingGate({hookQuestion: undefined, transcriptQuestion: false, awaitingPermission: true}),
		).toStrictEqual({kind: "permission"});
	});

	it("is none with nothing waiting", () => {
		expect(
			composerPendingGate({hookQuestion: null, transcriptQuestion: false, awaitingPermission: false}),
		).toStrictEqual({kind: "none"});
	});
});

describe("gateHoldsQueue", () => {
	it("holds queued prompts while any question or permission waits, as upstream blocks parked auto-send", () => {
		const gates: ComposerPendingGate[] = [
			{kind: "question", toolUseId: "toolu_alice", questions: [COLOR]},
			{kind: "held-question"},
			{kind: "permission"},
			{kind: "none"},
		];
		expect(gates.map(gateHoldsQueue)).toStrictEqual([true, true, true, false]);
	});
});

describe("composerSendPlan", () => {
	it("keeps upstream's composer enabled with its placeholder in every pending state", () => {
		const gates: ComposerPendingGate[] = [
			{kind: "question", toolUseId: "toolu_alice", questions: [COLOR]},
			{kind: "held-question"},
			{kind: "permission"},
			{kind: "none"},
		];
		expect(
			gates.map((gate) => {
				const plan = composerSendPlan(gate, {busy: false, queued: 0});
				return {disabled: plan.disabled, placeholder: plan.placeholder};
			}),
		).toStrictEqual([
			{disabled: false, placeholder: "Type / for commands"},
			{disabled: false, placeholder: "Type / for commands"},
			{disabled: false, placeholder: "Type / for commands"},
			{disabled: false, placeholder: "Type / for commands"},
		]);
	});

	it("dismisses a pending question with upstream's sentinel on every question, then queues the message", () => {
		expect(
			composerSendPlan(
				{kind: "question", toolUseId: "toolu_bob", questions: [COLOR, TOPPINGS]},
				{busy: false, queued: 0},
			),
		).toStrictEqual({
			disabled: false,
			placeholder: "Type / for commands",
			send: {
				kind: "dismiss-question-then-queue",
				toolUseId: "toolu_bob",
				answers: [
					{selected: [], other: QUESTION_DISMISSED_BY_MESSAGE},
					{selected: [], other: QUESTION_DISMISSED_BY_MESSAGE},
				],
			},
		});
	});

	it("uses upstream's exact dismissal text", () => {
		expect(QUESTION_DISMISSED_BY_MESSAGE).toBe(
			"[User did not answer this question — they sent a message instead. Treat that message as their response; do not re-ask.]",
		);
	});

	it("queues without typing into the pane while a question it cannot answer waits", () => {
		expect(composerSendPlan({kind: "held-question"}, {busy: false, queued: 0})).toStrictEqual({
			disabled: false,
			placeholder: "Type / for commands",
			send: {kind: "queue"},
		});
	});

	it("queues while a permission prompt waits, so the pane's dialog is never typed into", () => {
		expect(composerSendPlan({kind: "permission"}, {busy: false, queued: 0})).toStrictEqual({
			disabled: false,
			placeholder: "Type / for commands",
			send: {kind: "queue"},
		});
	});

	it("sends straight to an idle pane with nothing waiting", () => {
		expect(composerSendPlan({kind: "none"}, {busy: false, queued: 0})).toStrictEqual({
			disabled: false,
			placeholder: "Type / for commands",
			send: {kind: "send"},
		});
	});

	it("steers a working pane with nothing waiting, as upstream's Enter sends with priority next", () => {
		expect({
			working: composerSendPlan({kind: "none"}, {busy: true, queued: 0}).send,
			workingBehindQueue: composerSendPlan({kind: "none"}, {busy: true, queued: 2}).send,
		}).toStrictEqual({working: {kind: "steer"}, workingBehindQueue: {kind: "steer"}});
	});

	it("queues behind earlier queued prompts on an idle pane", () => {
		expect(composerSendPlan({kind: "none"}, {busy: false, queued: 2}).send).toStrictEqual({kind: "queue"});
	});

	it("falls back to queue for later on Enter while a dialog is open on a working pane", () => {
		expect({
			heldQuestion: composerSendPlan({kind: "held-question"}, {busy: true, queued: 0}).send,
			permission: composerSendPlan({kind: "permission"}, {busy: true, queued: 0}).send,
		}).toStrictEqual({heldQuestion: {kind: "queue"}, permission: {kind: "queue"}});
	});
});
