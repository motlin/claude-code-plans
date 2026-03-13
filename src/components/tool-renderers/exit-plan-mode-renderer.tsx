import {Link} from '@tanstack/react-router';
import {FileText} from 'lucide-react';
import type {ToolRendererProps} from './types';

const PLAN_FILE_RE = /\.claude\/plans\/([^/\s]+)\.md/;

export function ExitPlanModeRenderer({toolCall}: ToolRendererProps) {
	const {result} = toolCall;
	const planMatch = result?.match(PLAN_FILE_RE);

	return (
		<div className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
			<FileText size={14} />
			{planMatch ? (
				<Link
					to="/plan/$filename"
					params={{filename: planMatch[1]!}}
					className="hover:underline"
				>
					Plan created
				</Link>
			) : (
				<span>Exited plan mode</span>
			)}
		</div>
	);
}
