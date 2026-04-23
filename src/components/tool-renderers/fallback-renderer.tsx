import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';

export function FallbackRenderer({toolCall}: ToolRendererProps) {
	const {input, result, isError} = toolCall;
	const entries = Object.entries(input).filter(([k]) => k !== 'type');

	return (
		<ErrorBorder isError={isError}>
			{entries.length > 0 && (
				<dl className="text-xs mt-1">
					{entries.map(([key, value]) => (
						<div
							key={key}
							className="flex gap-2"
						>
							<dt className="text-text-500 font-mono shrink-0">{key}:</dt>
							<dd className="text-text-100 truncate">
								{typeof value === 'string' ? value : JSON.stringify(value)}
							</dd>
						</div>
					))}
				</dl>
			)}
			{result && (
				<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all mt-1 max-h-48 overflow-auto">
					{result}
				</pre>
			)}
		</ErrorBorder>
	);
}
