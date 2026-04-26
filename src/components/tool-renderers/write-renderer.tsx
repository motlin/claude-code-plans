import {Link} from '@tanstack/react-router';
import {FileText} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {CopyButton, ErrorBorder, ExpandableBlock} from './shared';

const PLAN_RE = /\.claude\/plans\/([^/]+)\.md$/;

/**
 * Split a file path into a truncatable prefix and a non-truncatable suffix.
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

export function WriteRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const content = toolCall.input['content'] as string | undefined;
	const {result, isError} = toolCall;
	const planMatch = filePath.match(PLAN_RE);
	const lineCount = content ? content.split('\n').length : 0;
	const {prefix, suffix} = splitPath(filePath);
	const copyText = content ?? result ?? filePath;

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
				{planMatch && (
					<Link
						to="/plan/$filename"
						params={{filename: planMatch[1]!}}
						className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 hover:underline shrink-0"
					>
						<FileText size={12} />
						Plan
					</Link>
				)}
				<CopyButton text={copyText} />
			</div>

			{/* Body: file content */}
			{content && (
				<div className="flex flex-col gap-g8 px-p6 pb-p8 text-code font-mono">
					<ExpandableBlock
						lineCount={lineCount}
						maxLines={20}
					>
						<div className="whitespace-pre-wrap break-all text-assistant-secondary">{content}</div>
					</ExpandableBlock>
				</div>
			)}
			{result && !content && <div className="px-p6 pb-p8 text-body text-assistant-secondary">{result}</div>}
		</ErrorBorder>
	);
}
