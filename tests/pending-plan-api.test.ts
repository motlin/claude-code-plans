import {QueryClient} from "@tanstack/react-query";
import {PendingPlanResponse, applyPendingPlanChanged, pendingPlanQueryOptions} from "../src/lib/api/pending-plan";
import {clearAllPendingPlans, setPendingPlan} from "../src/lib/pending-plan-store";
import {handlePendingPlanRequest} from "../src/routes/api/sessions.$id.pending-plan";

const PENDING = {
	toolUseId: "toolu_plan_alice",
	plan: "# Say hello\n\n1. Print hello",
	planFilePath: "/Users/alice/.claude/plans/say-hello.md",
};

afterEach(() => {
	clearAllPendingPlans();
});

describe("GET /api/sessions/$id/pending-plan", () => {
	it("returns the session's pending plan, or null for a session without one", async () => {
		setPendingPlan("session-alice", PENDING);

		const bodies = await Promise.all(
			["session-alice", "session-bob"].map(async (sessionId) =>
				PendingPlanResponse.parse(await handlePendingPlanRequest(sessionId).json()),
			),
		);

		expect(bodies).toStrictEqual([{pendingPlan: PENDING}, {pendingPlan: null}]);
	});
});

describe("PendingPlanResponse", () => {
	it("rejects fields the dock does not know", () => {
		expect(PendingPlanResponse.safeParse({pendingPlan: {...PENDING, allowedPrompts: []}}).success).toStrictEqual(
			false,
		);
	});
});

describe("applyPendingPlanChanged", () => {
	it("patches the session's cached pending plan from the SSE payload", () => {
		const queryClient = new QueryClient();

		applyPendingPlanChanged(queryClient, {sessionId: "session-alice", pendingPlan: PENDING});
		const proposed = queryClient.getQueryData(pendingPlanQueryOptions("session-alice").queryKey);
		applyPendingPlanChanged(queryClient, {sessionId: "session-alice", pendingPlan: null});
		const resolved = queryClient.getQueryData(pendingPlanQueryOptions("session-alice").queryKey);

		expect({proposed, resolved}).toStrictEqual({
			proposed: {pendingPlan: PENDING},
			resolved: {pendingPlan: null},
		});
	});
});
