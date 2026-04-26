import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function GrepRenderer({toolCall}: ToolRendererProps) {
	const pattern = (toolCall.input['pattern'] as string) ?? '';
	const path = toolCall.input['path'] as string | undefined;
	const glob = toolCall.input['glob'] as string | undefined;
	const fileType = toolCall.input['type'] as string | undefined;
	const outputMode = toolCall.input['output_mode'] as string | undefined;
	const caseInsensitive = toolCall.input['-i'] as boolean | undefined;
	const headLimit = toolCall.input['head_limit'] as number | undefined;
	const {result, isError} = toolCall;

	const params: Array<{key: string; value: string}> = [];
	if (pattern) params.push({key: 'pattern', value: pattern});
	if (outputMode) params.push({key: 'output_mode', value: outputMode});
	if (glob) params.push({key: 'glob', value: glob});
	if (fileType) params.push({key: 'type', value: fileType});
	if (path) params.push({key: 'path', value: path});
	if (caseInsensitive) params.push({key: '-i', value: 'true'});
	if (headLimit !== undefined) params.push({key: 'head_limit', value: String(headLimit)});

	return (
		<ErrorBorder isError={isError}>
			<KeyValueCard
				params={params}
				result={result ?? undefined}
			/>
		</ErrorBorder>
	);
}
