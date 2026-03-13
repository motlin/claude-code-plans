import type {ToolRendererProps} from './types';
import {CollapsibleSection, ToolMeta} from './shared';

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
		// No line number found, return null for lineNum and full line as content
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
	const {result} = toolCall;
	const lineCount = result ? result.split('\n').length : 0;

	const rangeInfo =
		offset !== undefined && limit !== undefined
			? `lines ${offset}-${offset + limit}`
			: offset !== undefined
				? `from line ${offset}`
				: `${lineCount} lines`;

	const parsedLines = result ? parseLineNumbers(result) : [];

	return (
		<div>
			<div className="bg-muted rounded px-2 py-1.5 mb-2 border border-border">
				<code className="text-xs font-mono break-all text-foreground">{filePath}</code>
			</div>
			<div className="text-xs text-muted-foreground mb-2">
				<ToolMeta>{rangeInfo}</ToolMeta>
			</div>
			{result && (
				<CollapsibleSection label="Show content">
					<div className="max-h-64 overflow-auto rounded border border-border">
						<div className="flex font-mono text-xs text-muted-foreground">
							{/* Line number gutter */}
							<div className="bg-muted/50 border-r border-border px-3 py-2 select-none text-right min-w-fit">
								{parsedLines.map((line, i) => (
									<div
										key={i}
										className="h-5 flex items-center justify-end"
									>
										{line.lineNum || ''}
									</div>
								))}
							</div>
							{/* Code content */}
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
				</CollapsibleSection>
			)}
		</div>
	);
}
