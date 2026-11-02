// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";

import {acknowledgeApproval, isApprovalAnswered, markApprovalAnswered} from "../src/lib/answered-approvals";
import {holdAnswered, isAnsweredHeld} from "../src/lib/answered-sessions";
import {
	isQuestionCardSent,
	markQuestionCardSeen,
	markQuestionCardSent,
	readQuestionCardState,
	wasQuestionCardSeen,
	writeQuestionCardState,
} from "../src/lib/question-card-store";

const STATE = {page: 0, drafts: [{selected: [0], other: "", otherChosen: false}], skipped: [false]};

// The shared-dom pool runs many files in one module graph, so module-level stores must start every test empty.
// The tests in this file run in either order: the one that arms the stores and the one that expects them empty.
describe("module-level stores reset after every test, as a fresh module would start", () => {
	it("arms holds, marks, acknowledgements, drafts, sent and seen cards without cleaning up", () => {
		holdAnswered("s-leak", "toolu_leak");
		markApprovalAnswered("s-leak", "toolu_marked");
		acknowledgeApproval("s-leak", "toolu_acknowledged", "Bash");
		writeQuestionCardState("card-leak", STATE);
		markQuestionCardSent("card-leak-sent", STATE, "s-leak");
		markQuestionCardSeen("card-leak");

		expect(isAnsweredHeld("s-leak")).toStrictEqual(true);
	});

	it("starts with none of them", () => {
		expect({
			held: isAnsweredHeld("s-leak"),
			marked: isApprovalAnswered("s-leak", "toolu_marked"),
			acknowledged: isApprovalAnswered("s-leak", "toolu_acknowledged"),
			draft: readQuestionCardState("card-leak", 1),
			sent: isQuestionCardSent("card-leak-sent"),
			seen: wasQuestionCardSeen("card-leak"),
		}).toStrictEqual({
			held: false,
			marked: false,
			acknowledged: false,
			draft: null,
			sent: false,
			seen: false,
		});
	});
});
