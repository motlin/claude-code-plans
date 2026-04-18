import {createFileRoute} from '@tanstack/react-router';
import {z} from 'zod';
import {formatAnswerPrompt} from '../../lib/ask-user-question';
import {handleCancel, spawnResumeStream} from '../../lib/spawn-resume';

const answerSchema = z.object({
	sessionId: z.string(),
	toolUseId: z.string(),
	answers: z
		.array(
			z.object({
				question: z.string(),
				answer: z.string(),
			}),
		)
		.min(1),
});

/**
 * Submit answers to a pending AskUserQuestion tool call. We resume the session
 * (forking, to avoid clobbering a CLI that might still hold the original file
 * open) with the answer formatted as the next user message. This is the only
 * mechanism Claude Code currently exposes for a third-party process to feed
 * input back to a session — there is no documented IPC for injecting a
 * `tool_result` directly, and the JSONL is owned by the running CLI.
 */
export const Route = createFileRoute('/api/answer-question')({
	server: {
		handlers: {
			POST: async ({request}: {request: Request}) => {
				const json: unknown = await request.json();

				const cancelled = handleCancel(json);
				if (cancelled) return cancelled;

				const parsed = answerSchema.safeParse(json);
				if (!parsed.success) {
					return Response.json({error: 'Invalid request', details: parsed.error.message}, {status: 400});
				}

				const {sessionId, toolUseId, answers} = parsed.data;
				const prompt = formatAnswerPrompt(toolUseId, answers);
				return spawnResumeStream({sessionId, prompt});
			},
		},
	},
});
