import {useState, useCallback, useRef} from 'react';

interface ChatStreamState {
	isStreaming: boolean;
	text: string;
	error?: string | undefined;
	forkedSessionId?: string | undefined;
	isComplete: boolean;
	sentPrompt?: string | undefined;
}

interface StreamEvent {
	type: string;
	subtype?: string;
	event?: {
		type: string;
		delta?: {type: string; text?: string};
		content_block?: {type: string; text?: string};
	};
	session_id?: string;
	message?: {
		content?: Array<{type: string; text?: string}>;
	};
	result?: string;
	is_error?: boolean;
}

export function useChatStream() {
	const [state, setState] = useState<ChatStreamState>({
		isStreaming: false,
		text: '',
		isComplete: false,
	});
	const processIdRef = useRef<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const send = useCallback(async (sessionId: string, prompt: string) => {
		setState({isStreaming: true, text: '', isComplete: false, sentPrompt: prompt});

		const abortController = new AbortController();
		abortRef.current = abortController;

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({sessionId, prompt}),
				signal: abortController.signal,
			});

			if (!res.ok) {
				const err = (await res.json()) as {error?: string};
				setState((s) => ({...s, isStreaming: false, isComplete: true, error: err.error ?? 'Request failed'}));
				return;
			}

			processIdRef.current = res.headers.get('X-Process-Id');

			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let accumulatedText = '';
			let forkedSessionId: string | undefined;

			while (true) {
				const {done, value} = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, {stream: true});
				const lines = buffer.split('\n');
				buffer = lines.pop()!;

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;

					let event: StreamEvent;
					try {
						event = JSON.parse(trimmed) as StreamEvent;
					} catch {
						continue;
					}

					if (event.type === 'stream_event' && event.event) {
						const ev = event.event;
						if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
							accumulatedText += ev.delta.text;
							setState((s) => ({...s, text: accumulatedText}));
						}
					} else if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
						forkedSessionId = event.session_id;
					} else if (event.type === 'result') {
						if (event.session_id) {
							forkedSessionId = event.session_id;
						}
						if (event.is_error) {
							setState((s) => {
								const next: ChatStreamState = {
									...s,
									isStreaming: false,
									isComplete: true,
									error: event.result ?? 'Unknown error',
								};
								if (forkedSessionId !== undefined) {
									next.forkedSessionId = forkedSessionId;
								}
								return next;
							});
							return;
						}
					} else if (event.type === 'error') {
						setState((s) => ({
							...s,
							isStreaming: false,
							isComplete: true,
							error: (event as unknown as {message: string}).message,
						}));
						return;
					}
				}
			}

			setState((s) => {
				const next: ChatStreamState = {...s, isStreaming: false, isComplete: true};
				if (forkedSessionId !== undefined) {
					next.forkedSessionId = forkedSessionId;
				}
				return next;
			});
		} catch (err) {
			if ((err as Error).name === 'AbortError') {
				setState((s) => ({...s, isStreaming: false, isComplete: true}));
			} else {
				setState((s) => ({
					...s,
					isStreaming: false,
					isComplete: true,
					error: (err as Error).message,
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
				await fetch('/api/chat', {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({action: 'cancel', processId: processIdRef.current}),
				});
			} catch {
				// best effort
			}
		}
	}, []);

	const reset = useCallback(() => {
		setState({isStreaming: false, text: '', isComplete: false});
	}, []);

	return {state, send, cancel, reset};
}
