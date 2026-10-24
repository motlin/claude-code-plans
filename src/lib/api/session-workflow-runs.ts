import {z} from "zod";
import {RuntimeWorkflowProgressEntrySchema, type WorkflowRunStatus} from "../workflow-progress";

const WORKFLOW_RUN_STATUSES = [
	"running",
	"completed",
	"failed",
	"stopped",
] as const satisfies readonly WorkflowRunStatus[];

/** One workflow run of a session (src/lib/workflow-runs.ts `WorkflowRun`). */
const SessionWorkflowRunSchema = z.object({
	runId: z.string(),
	taskId: z.string(),
	toolUseId: z.string(),
	toolUseIds: z.array(z.string()),
	workflowName: z.string(),
	scriptPath: z.string(),
	transcriptDir: z.string(),
	description: z.string(),
	status: z.enum(WORKFLOW_RUN_STATUSES),
	summary: z.string().nullable(),
	startedAt: z.number().nullable(),
	durationMs: z.number().nullable(),
	totalTokens: z.number().nullable(),
	progress: z.array(RuntimeWorkflowProgressEntrySchema),
});
export const SessionWorkflowRunsResponse = z.array(SessionWorkflowRunSchema);
export type SessionWorkflowRun = z.infer<typeof SessionWorkflowRunSchema>;
