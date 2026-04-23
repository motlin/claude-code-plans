import type {ToolRendererProps} from './types';
import {CollapsibleSection} from './shared';

export function SkillRenderer({toolCall}: ToolRendererProps) {
	const {result} = toolCall;

	if (!result) return null;

	if (result.length <= 200) {
		return <div className="text-xs text-text-500 whitespace-pre-wrap">{result}</div>;
	}

	return (
		<CollapsibleSection label="Output">
			<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all max-h-48 overflow-auto">
				{result}
			</pre>
		</CollapsibleSection>
	);
}
