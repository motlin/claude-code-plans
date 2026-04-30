import {Link} from '@tanstack/react-router';
import {FileText} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

const PLAN_FILE_RE = /\.claude\/plans\/([^/\s]+\.md)/;

export function ExitPlanModeRenderer({toolCall}: ToolRendererProps) {
	const {result} = toolCall;
	const planFilePath = (toolCall.input['planFilePath'] as string) ?? '';
	const planMatch = planFilePath.match(PLAN_FILE_RE) ?? result?.match(PLAN_FILE_RE);

	return (
		<ErrorBorder isError={toolCall.isError}>
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
		</ErrorBorder>
	);
}
