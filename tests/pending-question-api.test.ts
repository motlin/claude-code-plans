import {QueryClient} from "@tanstack/react-query";
import {
	PendingQuestionResponse,
	applyPendingQuestionChanged,
	pendingQuestionQueryOptions,
} from "../src/lib/api/pending-question";
import {clearAllPendingQuestions, setPendingQuestion} from "../src/lib/pending-question-store";
import {handlePendingQuestionRequest} from "../src/routes/api/sessions.$id.pending-question";

const PENDING = {
	toolUseId: "toolu_alice",
	questions: [
		{
			question: "Which color do you prefer?",
			header: "Color",
			multiSelect: false,
			options: [{label: "Red", description: "A warm color."}, {label: "Blue"}],
		},
	],
};

afterEach(() => {
	clearAllPendingQuestions();
});

describe("GET /api/sessions/$id/pending-question", () => {
	it("returns the session's pending question, or null for a session without one", async () => {
		setPendingQuestion("session-alice", PENDING);

		const bodies = await Promise.all(
			["session-alice", "session-bob"].map(async (sessionId) =>
				PendingQuestionResponse.parse(await handlePendingQuestionRequest(sessionId).json()),
			),
		);

		expect(bodies).toStrictEqual([{pendingQuestion: PENDING}, {pendingQuestion: null}]);
	});
});

describe("PendingQuestionResponse", () => {
	it("rejects fields the card does not know", () => {
		expect(PendingQuestionResponse.safeParse({pendingQuestion: {...PENDING, answers: {}}}).success).toStrictEqual(
			false,
		);
	});
});

describe("applyPendingQuestionChanged", () => {
	it("patches the session's cached pending question from the SSE payload", () => {
		const queryClient = new QueryClient();

		applyPendingQuestionChanged(queryClient, {sessionId: "session-alice", pendingQuestion: PENDING});
		const asked = queryClient.getQueryData(pendingQuestionQueryOptions("session-alice").queryKey);
		applyPendingQuestionChanged(queryClient, {sessionId: "session-alice", pendingQuestion: null});
		const resolved = queryClient.getQueryData(pendingQuestionQueryOptions("session-alice").queryKey);

		expect({asked, resolved}).toStrictEqual({
			asked: {pendingQuestion: PENDING},
			resolved: {pendingQuestion: null},
		});
	});
});
