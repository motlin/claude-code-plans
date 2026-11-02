import {describe, expect, it, vi} from "vite-plus/test";
import {expediteAfterAnswer} from "../src/lib/api/expedite-after-answer";

function answerRequest(body: unknown): Request {
	return new Request("http://localhost/api/herdr/permission", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(body),
	});
}

describe("expediteAfterAnswer", () => {
	it("expedites the answered session's JSONL read once the answer is delivered", async () => {
		const expedite = vi.fn<(sessionId: string) => void>();
		const handle = vi.fn<(request: Request) => Promise<Response>>(async (request: Request) =>
			Response.json({received: await request.json()}),
		);

		const response = await expediteAfterAnswer(
			answerRequest({sessionId: "alice-session", decision: "allow"}),
			handle,
			expedite,
		);

		expect({status: response.status, body: await response.json(), expedited: expedite.mock.calls}).toStrictEqual({
			status: 200,
			body: {received: {sessionId: "alice-session", decision: "allow"}},
			expedited: [["alice-session"]],
		});
	});

	it("leaves the throttle alone when the answer is refused", async () => {
		const expedite = vi.fn<(sessionId: string) => void>();
		const handle = async () => Promise.resolve(Response.json({error: "No pending permission"}, {status: 409}));

		const response = await expediteAfterAnswer(
			answerRequest({sessionId: "alice-session", decision: "allow"}),
			handle,
			expedite,
		);

		expect({status: response.status, expedited: expedite.mock.calls}).toStrictEqual({status: 409, expedited: []});
	});

	it("leaves the throttle alone when the body names no session", async () => {
		const expedite = vi.fn<(sessionId: string) => void>();
		const handle = async () => Promise.resolve(Response.json({ok: true}));

		await expediteAfterAnswer(answerRequest({decision: "allow"}), handle, expedite);
		await expediteAfterAnswer(
			new Request("http://localhost/api/herdr/plan", {method: "POST", body: "not json"}),
			handle,
			expedite,
		);

		expect(expedite.mock.calls).toStrictEqual([]);
	});
});
