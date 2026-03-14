import type {ToolRendererProps} from './types';
import {ToolMeta} from './shared';

export function GlobRenderer({toolCall}: ToolRendererProps) {
	const pattern = (toolCall.input['pattern'] as string) ?? '';
	const path = toolCall.input['path'] as string | undefined;
	const {result} = toolCall;
	const files = result?.trim() ? result.trim().split('\n') : [];
	const truncated = files.length > 50;
	const displayed = truncated ? files.slice(0, 50) : files;

	return (
		<div>
			<div className="bg-bg-200 rounded px-2 py-1.5 mb-2 border border-border-300/15">
				<code className="text-xs font-mono break-all text-text-100">{pattern}</code>
			</div>
			<div className="flex items-center gap-2 mb-2 flex-wrap">
				{path && <span className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">in {path}</span>}
				<ToolMeta>{files.length} files</ToolMeta>
			</div>
			{files.length > 0 && (
				<pre className="bg-bg-200 text-text-100 rounded text-xs leading-relaxed p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
					{displayed.join('\n')}
					{truncated && `\n... and ${files.length - 50} more files`}
				</pre>
			)}
		</div>
	);
}
