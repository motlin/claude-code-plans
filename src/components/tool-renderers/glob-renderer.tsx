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
			<div className="flex items-center gap-2">
				<code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{pattern}</code>
				{path && <span className="text-xs text-muted-foreground">in {path}</span>}
				<ToolMeta>{files.length} files</ToolMeta>
			</div>
			{files.length > 0 && (
				<pre className="bg-gray-900 text-cyan-300 rounded text-xs leading-relaxed p-2 mt-1 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
					{displayed.join('\n')}
					{truncated && `\n... and ${files.length - 50} more files`}
				</pre>
			)}
		</div>
	);
}
