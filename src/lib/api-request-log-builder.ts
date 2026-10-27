import type {z} from "zod";
import type {ApiRequestLog, ApiRequestSummary} from "./api-request-log";
import {ApiRequestRecordSchema, ApiRequestShapeRecordSchema} from "./runtime-schemas";

// Server-side: builds a session's request log from its transcript records. Kept apart from `api-request-log.ts` so the
// client, which only parses and resolves the log, doesn't download the transcript schemas.

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
