import {useState} from 'react';
import type {ToolRendererProps} from './types';
import {DiffLine, DiffStats, ErrorBorder} from './shared';

export function EditRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const {diffData, result, isError} = toolCall;
	const [showDiff, setShowDiff] = useState(!!isError);

	if (!diffData) {
		return (
			<ErrorBorder isError={isError}>
				<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap">{result}</pre>
			</ErrorBorder>
		);
	}

	return (
		<ErrorBorder isError={isError}>
			<div className="flex items-center gap-2 flex-wrap">
				<code className="text-xs font-mono text-text-500 bg-bg-100 px-1 py-0.5 rounded truncate">
					{filePath}
				</code>
				<DiffStats
					added={diffData.added}
					removed={diffData.removed}
				/>
			</div>
			{!showDiff && (
				<button
					type="button"
					onClick={() => setShowDiff(true)}
					className="text-[13px] text-text-500 hover:text-text-300 cursor-pointer transition-colors mt-1"
				>
					Show diff
				</button>
			)}
			{showDiff && (
				<div className="max-h-64 overflow-auto rounded border border-border-300/15 font-mono text-xs mt-1">
					{diffData.ops.map(([type, line], i) => (
						<DiffLine
							key={i}
							type={type}
							line={line}
						/>
					))}
				</div>
			)}
		</ErrorBorder>
	);
}
