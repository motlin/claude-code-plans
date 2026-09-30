export interface AnswerQuestionRequest {
	sessionId: string;
	toolUseId: string;
	answers: Array<{question: string; answer: string}>;
}

/**
 * Answer a pending AskUserQuestion through `/api/answer-question`, then drain
 * the streamed response so the spawned `claude --resume` runs to completion.
 * The SSE watcher refreshes the session views once the new JSONL is written.
 */
export async function postAnswerQuestion(request: AnswerQuestionRequest): Promise<void> {
	const res = await fetch("/api/answer-question", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(request),
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as {error?: string};
		throw new Error(body.error ?? `Request failed (${res.status})`);
	}
	const reader = res.body?.getReader();
	if (!reader) return;
	try {
		while (true) {
			const {done} = await reader.read();
			if (done) break;
		}
	} finally {
		reader.releaseLock();
	}
}
