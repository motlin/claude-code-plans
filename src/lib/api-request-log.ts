import {z} from "zod";

/*
 * The CLI (2.1.300+) logs every Messages API call as an `api-request` record,
 * with its system prompt and tool list in an `api-request-shape` record keyed
 * by `shapeHash`. An assistant record's `requestRef` names the request that
 * produced it. This is the browser's summary of that log: the params worth
 * reading, not the classifier context or the content-addressed messages.
 */

const ToolChangesSchema = z
	.object({
		added: z.array(z.string()),
		removed: z.array(z.string()),
	})
	.strict();

const ClassifierArtifactShareSummarySchema = z
	.object({
		mode: z.string(),
		role: z.string().optional(),
		isSharedLive: z.boolean(),
		probed: z.boolean(),
		probeFailed: z.boolean(),
		probeCurrentAccount: z.boolean(),
		typeLock: z.boolean(),
		livePaths: z.array(z.string()),
		/** Names of the runtime capabilities the page declares. */
		capabilities: z.array(z.string()),
		grantObserved: z.boolean(),
	})
	.strict();

/** One artifact the dangerous-tool-use classifier was told about. */
const ClassifierArtifactSummarySchema = z
	.object({
		id: z.string(),
		/** Local files published to this artifact. */
		paths: z.array(z.string()),
		/** Whether this was the session's most recent publish. */
		lastPublish: z.boolean(),
		publishedEnv: z.string().optional(),
		attested: z.string().optional(),
		share: ClassifierArtifactShareSummarySchema.optional(),
	})
	.strict();

const ApiRequestSummarySchema = z
	.object({
		id: z.string(),
		timestamp: z.string(),
		querySource: z.string(),
		shapeHash: z.string(),
		model: z.string(),
		betas: z.array(z.string()),
		maxTokens: z.number(),
		thinking: z.object({type: z.string(), display: z.string()}).strict(),
		effort: z.string(),
		/** The permission mode the dangerous-tool-use safeguard was told about. */
		permissionMode: z.string().optional(),
		/** Artifacts the classifier was told about, with their share state; absent when there were none. */
		artifacts: z.array(ClassifierArtifactSummarySchema).optional(),
		/** Tools gained and lost since this query source's previous request, when its shape changed. */
		toolChanges: ToolChangesSchema.optional(),
	})
	.strict();

const ApiRequestShapeSummarySchema = z
	.object({
		shapeHash: z.string(),
		/** System prompt blocks, in order. */
		system: z.array(z.string()),
		/** Tool names, in the order the request listed them. */
		tools: z.array(z.string()),
	})
	.strict();

export const ApiRequestLogSchema = z
	.object({
		requests: z.record(z.string(), ApiRequestSummarySchema),
		shapes: z.record(z.string(), ApiRequestShapeSummarySchema),
	})
	.strict();

export type ApiRequestSummary = z.infer<typeof ApiRequestSummarySchema>;
export type ClassifierArtifactSummary = z.infer<typeof ClassifierArtifactSummarySchema>;
export type ApiRequestShapeSummary = z.infer<typeof ApiRequestShapeSummarySchema>;
export type ApiRequestLog = z.infer<typeof ApiRequestLogSchema>;

export interface ResolvedApiRequest {
	request: ApiRequestSummary;
	/** Null when the session never logged the request's shape. */
	shape: ApiRequestShapeSummary | null;
}

/** The request an assistant record's `requestRef` names, with the shape it was sent with. */
export function resolveApiRequest(log: ApiRequestLog, requestRef: string): ResolvedApiRequest | null {
	const request = log.requests[requestRef];
	if (request === undefined) return null;
	return {request, shape: log.shapes[request.shapeHash] ?? null};
}
