import type {ThemedToken} from '@shikijs/core';
import {extractLineNumbers, detectLanguage} from '../../lib/diff-utils';
import {useHighlightedLines} from '../../hooks/use-shiki';
import type {ToolRendererProps} from './types';
import {CopyButton, ErrorBorder, ExpandableBlock} from './shared';

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

/**
 * Split a file path into a truncatable prefix and a non-truncatable suffix.
 * The suffix always includes the filename and enough parent directories
 * to land near the midpoint of the full path on a `/` boundary.
 */
function splitPath(filePath: string): {prefix: string; suffix: string} {
	const lastSlash = filePath.lastIndexOf('/');
	if (lastSlash === -1) return {prefix: '', suffix: filePath};

	const midpoint = Math.floor(filePath.length / 2);
	let splitIndex = -1;

	for (let i = midpoint; i >= 0; i--) {
		if (filePath[i] === '/') {
			splitIndex = i;
			break;
		}
	}

	if (splitIndex <= 0) {
		return {prefix: '', suffix: filePath};
	}

	return {
		prefix: filePath.slice(0, splitIndex + 1),
		suffix: filePath.slice(splitIndex + 1),
	};
}

export function ReadRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const {result, isError} = toolCall;
	const lineCount = result ? result.split('\n').length : 0;

	const parsedLines = result ? parseLineNumbers(result) : [];

	const {text: cleanCode} = result ? extractLineNumbers(result) : {text: ''};
	const language = detectLanguage(filePath);
	const tokens = useHighlightedLines(cleanCode, language);
	const {prefix, suffix} = splitPath(filePath);

	return (
		<ErrorBorder isError={isError}>
			{/* Header: smart-truncated file path + hover copy button */}
			<div className="flex items-center gap-g3 px-p6 py-p5">
				<span className="flex flex-1 min-w-0 text-body text-assistant-secondary">
					<span
						className="contents"
						title={filePath}
					>
						<span className="truncate">{prefix}</span>
						<span className="shrink-0">{suffix}</span>
					</span>
				</span>
				<CopyButton text={result ?? filePath} />
			</div>

			{/* Body: syntax-highlighted code */}
			{result && (
				<ExpandableBlock
					lineCount={lineCount}
					maxLines={20}
				>
					<div className="border-t border-border-300/15">
						<div className="flex font-mono text-code">
							<div className="bg-t1 border-r border-border-300/15 px-3 py-2 select-none text-right min-w-fit text-assistant-secondary">
								{parsedLines.map((line, index) => (
									<div
										key={index}
										className="h-[17px] flex items-center justify-end"
									>
										{line.lineNum || ''}
									</div>
								))}
							</div>
							<div className="flex-1 px-3 py-2 whitespace-pre-wrap break-all overflow-x-auto">
								{parsedLines.map((line, index) => (
									<div
										key={index}
										className="h-[17px] flex items-center"
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
