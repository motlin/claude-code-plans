import {useState, useCallback, useRef} from "react";
import {z} from "zod";

import {defined} from "../lib/defined";
import {errorMessage} from "../lib/narrow";
import type {LaunchOptions} from "../lib/launch-options";

interface ChatStreamState {
	isStreaming: boolean;
	text: string;
	error?: string | undefined;
	forkedSessionId?: string | undefined;
	isComplete: boolean;
	sentPrompt?: string | undefined;
}

/** The fields read from a `claude -p --output-format stream-json` line; the CLI's other fields are dropped. */
const StreamEventSchema = z.object({
	type: z.string(),
	subtype: z.string().optional(),
	event: z
		.object({
			type: z.string(),
			delta: z.object({type: z.string(), text: z.string().optional()}).optional(),
		})
		.optional(),
	session_id: z.string().optional(),
	// An object on assistant lines, the error text on `error` lines.
	message: z.unknown(),
	result: z.string().optional(),
	is_error: z.boolean().optional(),
});

async function readResponseError(response: Response): Promise<string> {
	const fallback = `Request failed (${response.status})`;
	const contentType = response.headers.get("Content-Type")?.toLowerCase();
	if (!contentType?.startsWith("application/json")) return fallback;

	const body: unknown = await response.json().catch(() => null);
	if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
		return body.error;
	}
	return fallback;
}

export function useChatStream() {
	const [state, setState] = useState<ChatStreamState>({
		isStreaming: false,
		text: "",
		isComplete: false,
	});
	const processIdRef = useRef<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const send = useCallback(async (sessionId: string, prompt: string, launchOptions: LaunchOptions = {}) => {
		setState({
			isStreaming: true,
			text: "",
			isComplete: false,
			sentPrompt: prompt,
		});

		const abortController = new AbortController();
		abortRef.current = abortController;

		try {
			const res = await fetch("/api/chat", {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify(
					Object.keys(launchOptions).length === 0 ? {sessionId, prompt} : {sessionId, prompt, launchOptions},
				),
				signal: abortController.signal,
			});

			if (!res.ok) {
				const error = await readResponseError(res);
				setState((s) => ({
					...s,
					isStreaming: false,
					isComplete: true,
					error,
				}));
				return;
			}

			processIdRef.current = res.headers.get("X-Process-Id");

			const reader = defined(res.body, "A successful chat stream response has a body").getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let accumulatedText = "";
			let forkedSessionId: string | undefined;

			while (true) {
				const {done, value} = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, {stream: true});
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;

					let parsed: unknown;
					try {
						parsed = JSON.parse(trimmed);
					} catch {
						continue;
					}
					const result = StreamEventSchema.safeParse(parsed);
					if (!result.success) continue;
					const event = result.data;

					if (event.type === "stream_event" && event.event) {
						const ev = event.event;
						if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
							accumulatedText += ev.delta.text;
							setState((s) => ({...s, text: accumulatedText}));
						}
					} else if (event.type === "system" && event.subtype === "init" && event.session_id) {
						forkedSessionId = event.session_id;
					} else if (event.type === "result") {
						if (event.session_id) {
							forkedSessionId = event.session_id;
						}
						if (event.is_error) {
							setState((s) => {
								const next: ChatStreamState = {
									...s,
									isStreaming: false,
									isComplete: true,
									error: event.result ?? "Unknown error",
								};
								if (forkedSessionId !== undefined) {
									next.forkedSessionId = forkedSessionId;
								}
								return next;
							});
							return;
						}
					} else if (event.type === "error") {
						setState((s) => ({
							...s,
							isStreaming: false,
							isComplete: true,
							error: typeof event.message === "string" ? event.message : undefined,
						}));
						return;
					}
				}
			}

			setState((s) => {
				const next: ChatStreamState = {
					...s,
					isStreaming: false,
					isComplete: true,
				};
				if (forkedSessionId !== undefined) {
					next.forkedSessionId = forkedSessionId;
				}
				return next;
			});
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				setState((s) => ({...s, isStreaming: false, isComplete: true}));
			} else {
				setState((s) => ({
					...s,
					isStreaming: false,
					isComplete: true,
					error: errorMessage(err),
				}));
			}
		} finally {
			abortRef.current = null;
			processIdRef.current = null;
		}
	}, []);

	const cancel = useCallback(async () => {
		abortRef.current?.abort();
		if (processIdRef.current) {
			try {
				await fetch("/api/chat", {
					method: "POST",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({
						action: "cancel",
						processId: processIdRef.current,
					}),
				});
			} catch {
				// best effort
			}
		}
	}, []);

	const reset = useCallback(() => {
		setState({isStreaming: false, text: "", isComplete: false});
	}, []);

	return {state, send, cancel, reset};
}
