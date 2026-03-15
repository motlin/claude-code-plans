import type {ToolRendererProps} from './types';
import {CollapsibleSection, ErrorBorder, ToolMeta} from './shared';

function parseLineNumbers(content: string): Array<{lineNum: string | null; content: string}> {
	const lines = content.split('\n');
	return lines.map((line) => {
		// Match line number at the start: digits followed by →
		const match = line.match(/^(\s*)(\d+)→(.*)$/);
		if (match) {
			return {
				lineNum: match[2] ?? null,
				content: match[3] ?? '',
			};
		}
		return {
			lineNum: null,
			content: line,
		};
	});
}

export function ReadRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const offset = toolCall.input['offset'] as number | undefined;
	const limit = toolCall.input['limit'] as number | undefined;
	const {result, highlightedHtml, isError} = toolCall;
	const lineCount = result ? result.split('\n').length : 0;

	const rangeInfo =
		offset !== undefined && limit !== undefined
			? `lines ${offset}-${offset + limit}`
			: offset !== undefined
				? `from line ${offset}`
				: `${lineCount} lines`;

	const parsedLines = result ? parseLineNumbers(result) : [];

	return (
		<ErrorBorder isError={isError}>
			<div className="flex items-center gap-2 flex-wrap">
				<code className="text-xs font-mono text-text-500 bg-bg-100 px-1 py-0.5 rounded truncate">
					{filePath}
				</code>
				<ToolMeta>{rangeInfo}</ToolMeta>
			</div>
			{result && (
				<CollapsibleSection label="Show content">
					{highlightedHtml ? (
						<div
							className="max-h-96 overflow-auto rounded border border-border-300/15 text-xs [&_pre]:p-3 [&_pre]:m-0 [&_pre]:rounded-none"
							dangerouslySetInnerHTML={{__html: highlightedHtml}}
						/>
					) : (
						<div className="max-h-64 overflow-auto rounded border border-border-300/15">
							<div className="flex font-mono text-xs text-text-500">
								<div className="bg-bg-200/50 border-r border-border-300/15 px-3 py-2 select-none text-right min-w-fit">
									{parsedLines.map((line, i) => (
										<div
											key={i}
											className="h-5 flex items-center justify-end"
										>
											{line.lineNum || ''}
										</div>
									))}
								</div>
								<div className="flex-1 px-3 py-2 whitespace-pre-wrap break-all">
									{parsedLines.map((line, i) => (
										<div
											key={i}
											className="h-5 flex items-center"
										>
											{line.content}
										</div>
									))}
								</div>
							</div>
						</div>
					)}
				</CollapsibleSection>
			)}
		</ErrorBorder>
	);
}
