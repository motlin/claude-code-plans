import type {ToolRendererProps} from './types';
import {CollapsibleSection} from './shared';

export function SkillRenderer({toolCall}: ToolRendererProps) {
	const skillName = (toolCall.input['skillName'] as string) ?? (toolCall.input['name'] as string) ?? '';
	const {result} = toolCall;

	return (
		<div>
			<span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
				{skillName}
			</span>
			{result && result.length <= 200 ? (
				<div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{result}</div>
			) : result ? (
				<CollapsibleSection label="Output">
					<pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-48 overflow-auto">
						{result}
					</pre>
				</CollapsibleSection>
			) : null}
		</div>
	);
}
