import type {ToolRendererProps} from './types';
import {CollapsibleSection, ToolMeta} from './shared';

export function ReadRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const offset = toolCall.input['offset'] as number | undefined;
	const limit = toolCall.input['limit'] as number | undefined;
	const {result} = toolCall;
	const lineCount = result ? result.split('\n').length : 0;

	const rangeInfo =
		offset !== undefined && limit !== undefined
			? `lines ${offset}-${offset + limit}`
			: offset !== undefined
				? `from line ${offset}`
				: `${lineCount} lines`;

	return (
		<div>
			<div className="bg-muted rounded px-2 py-1.5 mb-2 border border-border">
				<code className="text-xs font-mono break-all text-foreground">{filePath}</code>
			</div>
			<div className="text-xs text-muted-foreground mb-2">
				<ToolMeta>{rangeInfo}</ToolMeta>
			</div>
			{result && (
				<CollapsibleSection label="Show content">
					<pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-64 overflow-auto">
						{result}
					</pre>
				</CollapsibleSection>
			)}
		</div>
	);
}
