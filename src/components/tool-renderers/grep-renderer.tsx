import {useState} from 'react';
import type {ToolRendererProps} from './types';
import {ErrorBorder, TerminalOutput, ToolMeta} from './shared';

export function GrepRenderer({toolCall}: ToolRendererProps) {
	const pattern = (toolCall.input['pattern'] as string) ?? '';
	const path = toolCall.input['path'] as string | undefined;
	const glob = toolCall.input['glob'] as string | undefined;
	const fileType = toolCall.input['type'] as string | undefined;
	const caseInsensitive = toolCall.input['-i'] as boolean | undefined;
	const {result, isError} = toolCall;
	const matchCount = result?.trim() ? result.trim().split('\n').length : 0;
	const [showResults, setShowResults] = useState(!!isError);

	return (
		<ErrorBorder isError={isError}>
			<div className="flex items-center gap-2 flex-wrap">
				<code className="text-xs font-mono bg-bg-200 px-1.5 py-0.5 rounded">{pattern}</code>
				{glob && <span className="text-xs bg-bg-200 px-1.5 py-0.5 rounded">glob: {glob}</span>}
				{fileType && <span className="text-xs bg-bg-200 px-1.5 py-0.5 rounded">type: {fileType}</span>}
				{path && <span className="text-xs bg-bg-200 px-1.5 py-0.5 rounded">path: {path}</span>}
				{caseInsensitive && <span className="text-xs bg-bg-200 px-1.5 py-0.5 rounded">case-insensitive</span>}
				<ToolMeta>{matchCount} matches</ToolMeta>
			</div>
			{result && !showResults && (
				<button
					type="button"
					onClick={() => setShowResults(true)}
					className="text-[13px] text-text-500 hover:text-text-300 cursor-pointer transition-colors mt-1"
				>
					Show results
				</button>
			)}
			{result && showResults && (
				<div className="mt-1">
					<TerminalOutput
						content={result}
						maxLines={50}
						previewLines={10}
					/>
				</div>
			)}
		</ErrorBorder>
	);
}
