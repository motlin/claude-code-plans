import {Search} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {CollapsibleSection, ErrorBorder} from './shared';

export function WebSearchRenderer({toolCall}: ToolRendererProps) {
	const query = (toolCall.input['query'] as string) ?? '';
	const allowedDomains = toolCall.input['allowed_domains'] as string[] | undefined;
	const {result} = toolCall;

	return (
		<ErrorBorder isError={toolCall.isError}>
			<div className="flex items-start gap-2">
				<Search
					size={14}
					className="text-accent-100 mt-0.5 shrink-0"
				/>
				<div className="min-w-0">
					<div className="text-xs font-medium text-accent-100">Web Search</div>
					{query && <div className="text-xs text-text-100 mt-0.5 font-mono">{query}</div>}
					{allowedDomains && allowedDomains.length > 0 && (
						<div className="text-xs text-text-500 mt-0.5">Domains: {allowedDomains.join(', ')}</div>
					)}
					{result && (
						<div className="mt-1">
							<CollapsibleSection label="Results">
								<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all max-h-48 overflow-auto">
									{result}
								</pre>
							</CollapsibleSection>
						</div>
					)}
				</div>
			</div>
		</ErrorBorder>
	);
}
