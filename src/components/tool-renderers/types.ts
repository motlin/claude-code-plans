import type {DiffData} from '../../lib/renderer';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- TanStack serialization narrows unknown to {}
export type ToolInput = Record<string, {}>;

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
}

export interface ToolRendererProps {
	toolCall: ClientToolCall;
}
