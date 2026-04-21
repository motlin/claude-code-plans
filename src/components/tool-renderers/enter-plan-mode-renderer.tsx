import {FileText} from 'lucide-react';
import type {ToolRendererProps} from './types';

export function EnterPlanModeRenderer({toolCall}: ToolRendererProps) {
	const {result} = toolCall;

	return (
		<div className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
			<FileText size={14} />
			<span>Entered plan mode</span>
			{result && result !== 'success' && <span className="text-text-500 ml-1">{result}</span>}
		</div>
	);
}
