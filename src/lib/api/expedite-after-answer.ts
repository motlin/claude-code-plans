/** Read the request body's `sessionId` without consuming the body the handler parses. */
async function answeredSessionId(request: Request): Promise<string | null> {
	try {
		const body: unknown = await request.clone().json();
		if (typeof body !== "object" || body === null || !("sessionId" in body)) return null;
		const {sessionId} = body;
		return typeof sessionId === "string" && sessionId !== "" ? sessionId : null;
	} catch {
		return null;
	}
}

/**
 * Run an answer handler (question, permission prompt or plan), then, when it
 * delivered the answer, have the watcher read that session's JSONL right away
 * instead of waiting out its throttle, so the transcript catches up at once.
 */
export async function expediteAfterAnswer(
	request: Request,
	handle: (request: Request) => Promise<Response>,
	expedite: (sessionId: string) => void,
): Promise<Response> {
	const sessionId = await answeredSessionId(request);
	const response = await handle(request);
	if (response.ok && sessionId !== null) expedite(sessionId);
	return response;
}
