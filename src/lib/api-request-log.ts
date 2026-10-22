import {z} from "zod";

import {ApiRequestRecordSchema, ApiRequestShapeRecordSchema} from "./runtime-schemas";

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
export type ApiRequestShapeSummary = z.infer<typeof ApiRequestShapeSummarySchema>;
export type ApiRequestLog = z.infer<typeof ApiRequestLogSchema>;

/** Cheap pre-filter for JSONL lines worth parsing; blobs (the bulky messages) are excluded. */
export function mightBeApiRequestLogLine(line: string): boolean {
	return line.includes('"type":"api-request"') || line.includes('"type":"api-request-shape"');
}

function toolChanges(previous: readonly string[], current: readonly string[]) {
	const before = new Set(previous);
	const after = new Set(current);
	return {
		added: current.filter((name) => !before.has(name)),
		removed: previous.filter((name) => !after.has(name)),
	};
}

/** The request log carried by a session's records, in file order. Records the strict schemas reject are skipped. */
export function buildApiRequestLog(records: readonly unknown[]): ApiRequestLog {
	const requests: ApiRequestLog["requests"] = {};
	const shapes: ApiRequestLog["shapes"] = {};
	const parsedRequests: z.infer<typeof ApiRequestRecordSchema>[] = [];

	for (const record of records) {
		const shape = ApiRequestShapeRecordSchema.safeParse(record);
		if (shape.success) {
			shapes[shape.data.shapeHash] = {
				shapeHash: shape.data.shapeHash,
				system: shape.data.shape.system.map((block) => block.text),
				tools: shape.data.shape.tools.map((tool) => tool.name),
			};
			continue;
		}
		const parsed = ApiRequestRecordSchema.safeParse(record);
		if (parsed.success) parsedRequests.push(parsed.data);
	}

	// Shapes may be logged after the requests that use them, so diff once every shape is known.
	const previousShapeBySource = new Map<string, string>();
	for (const record of parsedRequests) {
		const {params} = record;
		const summary: ApiRequestSummary = {
			id: record.id,
			timestamp: record.timestamp,
			querySource: record.querySource,
			shapeHash: record.shapeHash,
			model: params.model,
			betas: params.betas,
			maxTokens: params.max_tokens,
			thinking: params.thinking,
			effort: params.output_config.effort,
		};
		const permissionMode = params.safeguards?.[0]?.classifier_context.permission_mode;
		if (permissionMode !== undefined) summary.permissionMode = permissionMode;

		const previousHash = previousShapeBySource.get(record.querySource);
		const previousShape = previousHash === undefined ? undefined : shapes[previousHash];
		const currentShape = shapes[record.shapeHash];
		if (previousHash !== record.shapeHash && previousShape !== undefined && currentShape !== undefined) {
			summary.toolChanges = toolChanges(previousShape.tools, currentShape.tools);
		}
		previousShapeBySource.set(record.querySource, record.shapeHash);
		requests[record.id] = summary;
	}

	return {requests, shapes};
}

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
