import type {ThemedToken} from '@shikijs/core';
import {extractLineNumbers, detectLanguage} from '../../lib/diff-utils';
import {useHighlightedLines} from '../../hooks/use-shiki';
import type {ToolRendererProps} from './types';
import {ErrorBorder, ExpandableBlock} from './shared';

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
	const {result, isError} = toolCall;
	const lineCount = result ? result.split('\n').length : 0;

	const parsedLines = result ? parseLineNumbers(result) : [];

	// Extract clean code (without line number prefixes) for highlighting.
	const {text: cleanCode} = result ? extractLineNumbers(result) : {text: ''};
	const language = detectLanguage(filePath);
	const tokens = useHighlightedLines(cleanCode, language);

	return (
		<ErrorBorder isError={isError}>
			<div className="bg-bg-200/40 rounded-lg overflow-clip flex flex-col">
				<div className="flex items-center gap-1 px-2 py-1.5 text-[13px] text-text-500 min-w-0">
					<span className="truncate min-w-0">{filePath}</span>
				</div>
				{result && (
					<ExpandableBlock
						lineCount={lineCount}
						maxLines={20}
					>
						<div className="grid grid-cols-[auto_1fr] font-mono text-xs leading-[17px]">
							<div className="select-none text-right text-text-500 py-0 pl-3.5 pr-[7px]">
								{parsedLines.map((line, index) => (
									<div key={index}>{line.lineNum || ' '}</div>
								))}
							</div>
							<div className="whitespace-pre-wrap break-all py-0 px-[7px]">
								{parsedLines.map((line, index) => (
									<div key={index}>
										{tokens?.[index] ? (
											<HighlightedLine tokens={tokens[index]} />
										) : (
											<PlainLine content={line.content} />
										)}
									</div>
								))}
							</div>
						</div>
					</ExpandableBlock>
				)}
			</div>
		</ErrorBorder>
	);
}
