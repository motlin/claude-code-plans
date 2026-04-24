import type {ThemedToken} from '@shikijs/core';
import {extractLineNumbers, detectLanguage} from '../../lib/diff-utils';
import {useHighlightedLines} from '../../hooks/use-shiki';
import type {ToolRendererProps} from './types';
import {ErrorBorder, ExpandableBlock, ToolMeta} from './shared';

interface ParsedLine {
	lineNum: string | null;
	content: string;
}

function parseLineNumbers(content: string): ParsedLine[] {
	const lines = content.split('\n');
	return lines.map((line) => {
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

function HighlightedLine({tokens}: {tokens: ThemedToken[]}) {
	return (
		<>
			{tokens.map((token, index) => (
				<span
					key={index}
					style={{color: token.color}}
				>
					{token.content}
				</span>
			))}
		</>
	);
}

function PlainLine({content}: {content: string}) {
	return <>{content}</>;
}

export function ReadRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const offset = toolCall.input['offset'] as number | undefined;
	const limit = toolCall.input['limit'] as number | undefined;
	const {result, isError} = toolCall;
	const lineCount = result ? result.split('\n').length : 0;

	const rangeInfo =
		offset !== undefined && limit !== undefined
			? `lines ${offset}-${offset + limit}`
			: offset !== undefined
				? `from line ${offset}`
				: `${lineCount} lines`;

	const parsedLines = result ? parseLineNumbers(result) : [];

	// Extract clean code (without line number prefixes) for highlighting.
	const {text: cleanCode} = result ? extractLineNumbers(result) : {text: ''};
	const language = detectLanguage(filePath);
	const tokens = useHighlightedLines(cleanCode, language);

	return (
		<ErrorBorder isError={isError}>
			<div className="flex items-center gap-2 flex-wrap mb-1">
				<code className="text-xs font-mono text-text-500 bg-bg-100 px-1 py-0.5 rounded truncate">
					{filePath}
				</code>
				<ToolMeta>{rangeInfo}</ToolMeta>
			</div>
			{result && (
				<ExpandableBlock
					lineCount={lineCount}
					maxLines={20}
				>
					<div className="rounded border border-border-300/15">
						<div className="flex font-mono text-xs text-text-500">
							<div className="bg-bg-200/50 border-r border-border-300/15 px-3 py-2 select-none text-right min-w-fit">
								{parsedLines.map((line, index) => (
									<div
										key={index}
										className="h-5 flex items-center justify-end"
									>
										{line.lineNum || ''}
									</div>
								))}
							</div>
							<div className="flex-1 px-3 py-2 whitespace-pre-wrap break-all">
								{parsedLines.map((line, index) => (
									<div
										key={index}
										className="h-5 flex items-center"
									>
										{tokens?.[index] ? (
											<HighlightedLine tokens={tokens[index]} />
										) : (
											<PlainLine content={line.content} />
										)}
									</div>
								))}
							</div>
						</div>
					</div>
				</ExpandableBlock>
			)}
		</ErrorBorder>
	);
}
