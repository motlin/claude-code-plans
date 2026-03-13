import type {ToolRendererProps} from './types';
import {TerminalOutput} from './shared';

export function BashRenderer({toolCall}: ToolRendererProps) {
	const command = (toolCall.input['command'] as string) ?? '';
	const description = toolCall.input['description'] as string | undefined;
	const {result, isError} = toolCall;

	return (
		<div className={isError ? 'border-l-2 border-red-500 pl-2' : ''}>
			<div className="bg-gray-900 rounded px-2 py-1.5 mb-1">
				{description && <div className="text-xs text-gray-400 mb-0.5">{description}</div>}
				<div className="font-mono text-xs">
					<span className="text-gray-500">$ </span>
					<span className="text-green-400">{command}</span>
				</div>
			</div>
			{result && (
				<div>
					<div className="bg-gray-900 rounded px-2 py-1 mb-1">
						<div className="font-mono text-xs">
							<span className="text-gray-500">$ </span>
							<span className="text-green-400">{command}</span>
						</div>
					</div>
					<TerminalOutput content={result} />
				</div>
			)}
		</div>
	);
}
