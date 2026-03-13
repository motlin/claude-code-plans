import type {ToolRendererProps} from './types';
import {CollapsibleSection, ToolMeta} from './shared';

export function WebFetchRenderer({toolCall}: ToolRendererProps) {
	const url = (toolCall.input['url'] as string) ?? '';
	const prompt = toolCall.input['prompt'] as string | undefined;
	const {result, isError} = toolCall;

	return (
		<div className={isError ? 'border-l-2 border-red-500 pl-2' : ''}>
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">URL:</span>
					<a
						href={url}
						target="_blank"
						rel="noopener noreferrer"
						className="text-xs text-primary hover:underline break-all"
						title={url}
					>
						{url}
					</a>
				</div>

				{prompt && (
					<div className="text-xs text-muted-foreground">
						<ToolMeta>Prompt: {prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt}</ToolMeta>
					</div>
				)}

				{result && (
					<CollapsibleSection
						label="Show response"
						defaultOpen={!isError}
					>
						<pre
							className={`text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto rounded px-2 py-1.5 ${
								isError
									? 'bg-red-50 dark:bg-red-950/20 text-red-900 dark:text-red-200 border border-red-200 dark:border-red-800'
									: 'bg-gray-50 dark:bg-gray-900/30 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'
							}`}
						>
							{result}
						</pre>
					</CollapsibleSection>
				)}
			</div>
		</div>
	);
}
