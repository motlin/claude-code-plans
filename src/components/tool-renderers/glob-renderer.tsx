import {useState} from 'react';
import type {ToolRendererProps} from './types';
import {ErrorBorder, ToolMeta} from './shared';

export function GlobRenderer({toolCall}: ToolRendererProps) {
	const pattern = (toolCall.input['pattern'] as string) ?? '';
	const path = toolCall.input['path'] as string | undefined;
	const {result, isError} = toolCall;
	const files = result?.trim() ? result.trim().split('\n') : [];
	const [showFiles, setShowFiles] = useState(false);
	const previewCount = 10;
	const displayed = showFiles ? files : files.slice(0, previewCount);

	return (
		<ErrorBorder isError={isError}>
			<div className="flex items-center gap-2 flex-wrap">
				<code className="text-xs font-mono bg-bg-200 px-1.5 py-0.5 rounded">{pattern}</code>
				{path && <span className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">in {path}</span>}
				<ToolMeta>{files.length} files</ToolMeta>
			</div>
			{files.length > 0 && (
				<pre className="bg-bg-200 text-text-100 rounded text-xs leading-relaxed p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto mt-1">
					{displayed.join('\n')}
				</pre>
			)}
			{!showFiles && files.length > previewCount && (
				<button
					type="button"
					onClick={() => setShowFiles(true)}
					className="pt-1 text-xs text-text-500/80 hover:text-text-100 transition cursor-pointer"
				>
					+{files.length - previewCount} more files
				</button>
			)}
		</ErrorBorder>
	);
}
