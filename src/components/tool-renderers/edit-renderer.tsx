import type {ToolRendererProps} from './types';
import {DiffLine, DiffStats} from './shared';

export function EditRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const {diffData, result} = toolCall;

	if (!diffData) {
		return <pre className="text-xs font-mono text-text-500 whitespace-pre-wrap">{result}</pre>;
	}

	return (
		<div>
			<div className="bg-bg-200 rounded px-2 py-1.5 mb-2 border border-border-300/15">
				<code className="text-xs font-mono break-all text-text-100">{filePath}</code>
			</div>
			<div className="flex items-center gap-2 mb-2">
				<DiffStats
					added={diffData.added}
					removed={diffData.removed}
				/>
			</div>
			<div className="max-h-64 overflow-auto rounded border border-border-300/15 font-mono text-xs">
				{diffData.ops.map(([type, line], i) => (
					<DiffLine
						key={i}
						type={type}
						line={line}
					/>
				))}
			</div>
		</div>
	);
}
