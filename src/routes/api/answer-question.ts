import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {z} from "zod";
import {formatAnswerPrompt} from "../../lib/ask-user-question";
import {rejectCrossSite} from "../../lib/same-origin-guard";
import {handleCancel, spawnResumeStream} from "../../lib/spawn-resume";

/** Upstream's response shape: a label, or every label of a multi-select, plus a single-select's picked preview. */
export const answerQuestionBodySchema = z.object({
	sessionId: z.string(),
	toolUseId: z.string(),
	answers: z
		.array(
			z
				.object({
					question: z.string(),
					response: z.union([z.string(), z.array(z.string()).min(1)]),
					preview: z.string().optional(),
				})
				.strict(),
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
export const Route = createFileRoute("/api/answer-question")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const rejection = rejectCrossSite(request);
				if (rejection) return rejection;

				const json: unknown = await request.json();

				const cancelled = handleCancel(json);
				if (cancelled) return cancelled;

				const parsed = answerQuestionBodySchema.safeParse(json);
				if (!parsed.success) {
					return Response.json({error: "Invalid request", details: parsed.error.message}, {status: 400});
				}

				const {sessionId, toolUseId, answers} = parsed.data;
				const prompt = formatAnswerPrompt(toolUseId, answers);
				return spawnResumeStream({sessionId, prompt});
			},
		}),
	},
});
