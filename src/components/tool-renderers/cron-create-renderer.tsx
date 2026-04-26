import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function CronCreateRenderer({toolCall}: ToolRendererProps) {
	const cron = (toolCall.input['cron'] as string) ?? '';
	const prompt = (toolCall.input['prompt'] as string) ?? '';
	const recurring = toolCall.input['recurring'] as boolean | undefined;

	const params: Array<{key: string; value: string}> = [];
	if (cron) params.push({key: 'cron', value: cron});
	if (prompt) params.push({key: 'prompt', value: prompt});
	if (recurring !== undefined) params.push({key: 'recurring', value: String(recurring)});

	return (
		<ErrorBorder isError={toolCall.isError}>
			<KeyValueCard
				params={params}
				result={toolCall.result ?? undefined}
			/>
		</ErrorBorder>
	);
}
