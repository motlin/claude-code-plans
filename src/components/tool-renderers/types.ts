import type {MessageSessionLine, SessionContentBlock, ToolResultInfo} from '../../lib/sessions';
import type {SubagentTreeEntry, SubagentTreeNode, ParallelGroup} from '../../lib/db/queries';

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
	duration?: number | undefined;
	sourceUuid: string;
	resultUuid?: string | undefined;
	subagentInfo?: SubagentInlineInfo | undefined;
}

export interface ToolRendererProps {
	toolCall: ClientToolCall;
}

const AGENT_ID_RE = /agentId:\s*(\S+)/;

function isParallelGroup(entry: SubagentTreeEntry): entry is ParallelGroup {
	return (entry as ParallelGroup).type === 'parallel';
}

function statusForAgent(agent: {finishedAt: string | null}): 'running' | 'done' | 'error' {
	if (!agent.finishedAt) return 'running';
	return 'done';
}

interface SubagentLookup {
	byBareId: Map<string, SubagentInlineInfo>;
	byTypeAndDescription: Map<string, SubagentInlineInfo>;
}

function lookupKey(agentType: string | null, description: string | null): string {
	return `${agentType ?? ''}::${description ?? ''}`;
}

export function buildSubagentLookup(tree: SubagentTreeEntry[]): SubagentLookup {
	const byBareId = new Map<string, SubagentInlineInfo>();
	const byTypeAndDescription = new Map<string, SubagentInlineInfo>();
	let parallelCounter = 0;

	function addNode(node: SubagentTreeNode, parallelKey?: string, parallelSize?: number): void {
		const bareId = node.agent.id.replace(/^agent-/, '');
		const entry: SubagentInlineInfo = {
			agentId: node.agent.id,
			agentType: node.agent.agentType,
			slug: node.agent.slug,
			description: node.agent.description,
			startedAt: node.agent.startedAt,
			finishedAt: node.agent.finishedAt,
			status: statusForAgent(node.agent),
		};
		if (parallelKey !== undefined) entry.parallelGroupKey = parallelKey;
		if (parallelSize !== undefined) entry.parallelGroupSize = parallelSize;
		byBareId.set(bareId, entry);
		if (node.agent.description) {
			byTypeAndDescription.set(lookupKey(node.agent.agentType, node.agent.description), entry);
		}
		walk(node.children);
	}

	function walk(entries: SubagentTreeEntry[]): void {
		for (const entry of entries) {
			if (isParallelGroup(entry)) {
				const key = `pg-${parallelCounter++}`;
				const size = entry.children.length;
				for (const child of entry.children) {
					addNode(child, key, size);
				}
			} else {
				addNode(entry);
			}
		}
	}

	walk(tree);
	return {byBareId, byTypeAndDescription};
}

function resolveSubagentInfo(
	name: string,
	input: Record<string, unknown>,
	result: string | undefined,
	isError: boolean | undefined,
	subagentLookup: SubagentLookup,
): SubagentInlineInfo | undefined {
	if (name !== 'Agent') return undefined;

	let info: SubagentInlineInfo | undefined;
	if (result) {
		const match = AGENT_ID_RE.exec(result);
		if (match?.[1]) {
			info = subagentLookup.byBareId.get(match[1]);
		}
	}
	if (!info) {
		const inputAgentType = (input['subagent_type'] as string) ?? null;
		const inputDescription = (input['description'] as string) ?? null;
		if (inputDescription) {
			info = subagentLookup.byTypeAndDescription.get(lookupKey(inputAgentType, inputDescription));
		}
	}
	if (info) {
		return {
			...info,
			status: isError ? 'error' : info.status,
		};
	}
	return undefined;
}

/**
 * Build a ClientToolCall from raw JSONL data + sidecar maps.
 * Computes all decorations client-side (diff data, markdown rendering,
 * subagent info lookup).
 */
export function buildClientToolCall(
	block: SessionContentBlock,
	line: MessageSessionLine,
	toolResultMap: Map<string, ToolResultInfo>,
	subagentLookup: SubagentLookup,
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

	// Resolve subagent info client-side from the subagent tree
	const subagentInfo = resolveSubagentInfo(name, block.input ?? {}, call.result, call.isError, subagentLookup);
	if (subagentInfo) call.subagentInfo = subagentInfo;

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
