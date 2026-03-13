import {Link} from '@tanstack/react-router';
import {FileText} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {CollapsibleSection, FilePath, ToolMeta} from './shared';

const PLAN_RE = /\.claude\/plans\/([^/]+)\.md$/;

export function WriteRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input['file_path'] as string) ?? '';
	const content = toolCall.input['content'] as string | undefined;
	const {result} = toolCall;
	const planMatch = filePath.match(PLAN_RE);
	const lineCount = content ? content.split('\n').length : 0;

	return (
		<div>
			<div className="flex items-center gap-2">
				<FilePath path={filePath} />
				{planMatch && (
					<Link
						to="/plan/$filename"
						params={{filename: planMatch[1]!}}
						className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 hover:underline"
					>
						<FileText size={12} />
						Plan file
					</Link>
				)}
				{content && <ToolMeta>{lineCount} lines</ToolMeta>}
			</div>
			{content && lineCount <= 100 && (
				<CollapsibleSection label="Show content">
					<pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-64 overflow-auto">
						{content}
					</pre>
				</CollapsibleSection>
			)}
			{result && <div className="text-xs text-muted-foreground mt-1">{result}</div>}
		</div>
	);
}
