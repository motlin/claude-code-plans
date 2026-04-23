import {MarkdownArticle} from '../markdown-article';
import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';
import {looksLikeMarkdown} from '../../lib/client-markdown';

function tryFormatJson(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

export function McpRenderer({toolCall}: ToolRendererProps) {
	const {input, result, isError} = toolCall;
	const hasInput = Object.keys(input).length > 0;

	return (
		<ErrorBorder isError={isError}>
			{hasInput && (
				<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all max-h-48 overflow-auto">
					{JSON.stringify(input, null, 2)}
				</pre>
			)}
			{result && (
				<div className="mt-1">
					{looksLikeMarkdown(result) ? (
						<div className="text-xs text-text-100 leading-relaxed max-h-64 overflow-auto">
							<MarkdownArticle markdown={result} />
						</div>
					) : (
						<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all max-h-64 overflow-auto">
							{tryFormatJson(result)}
						</pre>
					)}
				</div>
			)}
		</ErrorBorder>
	);
}
