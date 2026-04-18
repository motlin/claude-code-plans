import type {DiffData} from '../../lib/renderer';

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
