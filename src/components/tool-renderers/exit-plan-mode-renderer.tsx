import {Link} from '@tanstack/react-router';
import {FileText} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {KeyValueCard} from './shared';

const PLAN_FILE_RE = /\.claude\/plans\/([^/\s]+)\.md/;

export function ExitPlanModeRenderer({toolCall}: ToolRendererProps) {
	const {result} = toolCall;
	const planMatch = result?.match(PLAN_FILE_RE);

	return (
		<KeyValueCard
			params={[]}
			result={result ?? undefined}
		>
			{planMatch && (
				<Link
					to="/plan/$filename"
					params={{filename: planMatch[1]!}}
					className="inline-flex items-center gap-1 text-body text-accent-100 hover:underline"
				>
					<FileText size={12} />
					Plan created
				</Link>
			)}
		</KeyValueCard>
	);
}
