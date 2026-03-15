import {MarkdownArticle} from '../markdown-article';
import type {ToolRendererProps} from './types';
import {CollapsibleSection, ErrorBorder} from './shared';

function parseMcpName(name: string): {server: string; tool: string} {
	const stripped = name.replace(/^mcp__/, '');
	const parts = stripped.split('__');
	if (parts.length >= 2) {
		return {server: parts[0]!, tool: parts.slice(1).join('__')};
	}
	return {server: stripped, tool: stripped};
}

function tryFormatJson(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

export function McpRenderer({toolCall}: ToolRendererProps) {
	const {server, tool} = parseMcpName(toolCall.name);
	const {input, result} = toolCall;
	const hasInput = Object.keys(input).length > 0;

	const {isError} = toolCall;

	return (
		<ErrorBorder isError={isError}>
			<div className="flex items-center gap-2">
				<span className="rounded px-1.5 py-0.5 text-xs font-medium bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">
					{server}
				</span>
				<span className="text-xs text-text-500">{tool}</span>
			</div>
			{hasInput && (
				<CollapsibleSection label="Input">
					<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all max-h-48 overflow-auto">
						{JSON.stringify(input, null, 2)}
					</pre>
				</CollapsibleSection>
			)}
			{result && (
				<CollapsibleSection
					label="Output"
					defaultOpen={!!isError}
				>
					{toolCall.resultHtml ? (
						<div className="text-xs text-text-100 leading-relaxed max-h-64 overflow-auto">
							<MarkdownArticle html={toolCall.resultHtml} />
						</div>
					) : (
						<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all max-h-64 overflow-auto">
							{tryFormatJson(result)}
						</pre>
					)}
				</CollapsibleSection>
			)}
		</ErrorBorder>
	);
}
