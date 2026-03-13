import type {ToolRendererProps} from './types';
import {DiffLine, DiffStats, FilePath} from './shared';

export function EditRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const {diffData, result} = toolCall;

	if (!diffData) {
		return <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">{result}</pre>;
	}

	return (
		<div>
			<div className="flex items-center gap-2 mb-1">
				<FilePath path={filePath} />
				<DiffStats
					added={diffData.added}
					removed={diffData.removed}
				/>
			</div>
			<div className="max-h-64 overflow-auto rounded border border-border font-mono text-xs">
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
