import {MarkdownArticle} from '../markdown-article';
import type {ToolRendererProps} from './types';
import {CollapsibleSection, ErrorBorder, ToolMeta} from './shared';

export function WebFetchRenderer({toolCall}: ToolRendererProps) {
	const url = (toolCall.input['url'] as string) ?? '';
	const prompt = toolCall.input['prompt'] as string | undefined;
	const {result, isError} = toolCall;

	return (
		<ErrorBorder isError={isError}>
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center gap-2">
					<a
						href={url}
						target="_blank"
						rel="noopener noreferrer"
						className="text-xs text-accent-100 hover:underline break-all"
						title={url}
					>
						{url}
					</a>
				</div>

				{prompt && (
					<div className="text-xs text-text-500">
						<ToolMeta>Prompt: {prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt}</ToolMeta>
					</div>
				)}

				{result && (
					<CollapsibleSection
						label="Show response"
						defaultOpen={!isError}
					>
						{toolCall.resultHtml ? (
							<div className="text-xs text-text-100 leading-relaxed max-h-64 overflow-auto">
								<MarkdownArticle html={toolCall.resultHtml} />
							</div>
						) : (
							<pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto rounded px-2 py-1.5 bg-bg-200 text-text-100">
								{result}
							</pre>
						)}
					</CollapsibleSection>
				)}
			</div>
		</ErrorBorder>
	);
}
