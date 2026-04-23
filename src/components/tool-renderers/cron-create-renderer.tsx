import {Clock} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';

export function CronCreateRenderer({toolCall}: ToolRendererProps) {
	const cron = (toolCall.input['cron'] as string) ?? '';
	const prompt = (toolCall.input['prompt'] as string) ?? '';
	const recurring = toolCall.input['recurring'] as boolean | undefined;

	return (
		<ErrorBorder isError={toolCall.isError}>
			<div className="flex items-start gap-2">
				<Clock
					size={14}
					className="text-accent-100 mt-0.5 shrink-0"
				/>
				<div className="min-w-0">
					{recurring === false && <div className="text-xs text-text-500">(one-time)</div>}
					{cron && <div className="text-xs text-text-500 mt-0.5 font-mono">{cron}</div>}
					{prompt && <div className="text-xs text-text-100 mt-0.5 line-clamp-3">{prompt}</div>}
				</div>
			</div>
		</ErrorBorder>
	);
}
