import type {DiffData} from '../../lib/renderer';
import type {MessageSessionLine, SessionContentBlock, ToolResultInfo} from '../../lib/sessions';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- TanStack serialization narrows unknown to {}
export type ToolInput = Record<string, {}>;

export interface SubagentInlineInfo {
	agentId: string;
	agentType: string | null;
	slug: string | null;
	description: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	status: 'running' | 'done' | 'error';
	parallelGroupKey?: string | undefined;
	parallelGroupSize?: number | undefined;
}

/**
 * Server-computed decoration for a single tool_use block, keyed by tool_use.id.
 * These are computed once in the route loader and looked up by renderers.
 */
export interface ToolDecoration {
	diffData?: DiffData | undefined;
	highlightedHtml?: string | undefined;
	resultHtml?: string | undefined;
	subagentInfo?: SubagentInlineInfo | undefined;
}

/**
 * Map from tool_use.id to its server-computed decoration.
 */
export type DecorationMap = Map<string, ToolDecoration>;

/**
 * Serializable version of DecorationMap for TanStack serialization.
 */
export type SerializedDecorationMap = Array<[string, ToolDecoration]>;

/**
 * Serializable version of ToolResultInfo map for TanStack serialization.
 */
export type SerializedToolResultMap = Array<[string, ToolResultInfo]>;

/**
 * ClientToolCall is the flattened shape passed to individual tool renderers.
 * Built at render time from raw JSONL block + decorations + tool result info.
 */
export interface ClientToolCall {
	id: string;
	name: string;
	input: ToolInput;
	param: string;
	result?: string | undefined;
	isError?: boolean | undefined;
	diffData?: DiffData | undefined;
	highlightedHtml?: string | undefined;
	resultHtml?: string | undefined;
	duration?: number | undefined;
	sourceUuid: string;
	resultUuid?: string | undefined;
	subagentInfo?: SubagentInlineInfo | undefined;
}

export interface ToolRendererProps {
	toolCall: ClientToolCall;
}

/**
 * Build a ClientToolCall from raw JSONL data + sidecar maps.
 * This replaces the server-side mutation that previously built ClientToolCall
 * in the route loader.
 */
export function buildClientToolCall(
	block: SessionContentBlock,
	line: MessageSessionLine,
	toolResultMap: Map<string, ToolResultInfo>,
	decorations: DecorationMap,
): ClientToolCall {
	const id = block.id ?? '';
	const name = block.name ?? '';
	const input = (block.input ?? {}) as ToolInput;
	const sourceUuid = line.uuid ?? '';

	const call: ClientToolCall = {
		id,
		name,
		input,
		param: getToolParam({input: block.input ?? {}}),
		sourceUuid,
	};

	// Attach tool result info from pairing map
	const resultInfo = toolResultMap.get(id);
	if (resultInfo) {
		call.result = resultInfo.result;
		if (resultInfo.isError) call.isError = true;
		call.resultUuid = resultInfo.resultUuid;
		if (resultInfo.duration !== undefined) call.duration = resultInfo.duration;
	}

	// Attach server-computed decorations
	const deco = decorations.get(id);
	if (deco) {
		if (deco.diffData) call.diffData = deco.diffData;
		if (deco.highlightedHtml) call.highlightedHtml = deco.highlightedHtml;
		if (deco.resultHtml) call.resultHtml = deco.resultHtml;
		if (deco.subagentInfo) call.subagentInfo = deco.subagentInfo;
	}

	return call;
}

function getToolParam(tc: {input: Record<string, unknown>}): string {
	const input = tc.input;
	if (typeof input['file_path'] === 'string') return input['file_path'];
	if (typeof input['command'] === 'string') {
		const cmd = input['command'];
		return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
	}
	if (typeof input['pattern'] === 'string') return input['pattern'];
	if (typeof input['query'] === 'string') return input['query'];
	if (typeof input['url'] === 'string') return input['url'];
	if (typeof input['prompt'] === 'string') {
		const p = input['prompt'];
		return p.length > 60 ? p.slice(0, 60) + '...' : p;
	}
	if (typeof input['subject'] === 'string') {
		const s = input['subject'];
		return s.length > 60 ? s.slice(0, 60) + '...' : s;
	}
	if (typeof input['taskId'] === 'string') return `#${input['taskId']}`;
	return '';
}
