import {useState} from 'react';
import type {ToolRendererProps} from './types';
import {ErrorBorder, TerminalOutput} from './shared';

function stripCommandPrefix(content: string, command: string): string {
	const prefix = `$ ${command}\n`;
	if (content.startsWith(prefix)) {
		return content.slice(prefix.length);
	}
	return content;
}

export function BashRenderer({toolCall}: ToolRendererProps) {
	const command = (toolCall.input['command'] as string) ?? '';
	const description = toolCall.input['description'] as string | undefined;
	const {result, isError} = toolCall;
	const [showResult, setShowResult] = useState(!!isError);
	const resultContent = result ? stripCommandPrefix(result, command) : null;
	const lineCount = resultContent ? resultContent.split('\n').length : 0;

	return (
		<ErrorBorder isError={isError}>
			<div className="bg-bg-200 rounded px-2 py-1.5 mb-1">
				{description && <div className="text-xs text-text-500 mb-0.5">{description}</div>}
				<div className="font-mono text-xs">
					<span className="text-text-500">$ </span>
					<span className="text-green-700 dark:text-green-400">{command}</span>
				</div>
			</div>
			{resultContent && !showResult && (
				<button
					type="button"
					onClick={() => setShowResult(true)}
					className="text-[13px] text-text-500 hover:text-text-300 cursor-pointer transition-colors"
				>
					{lineCount} lines
				</button>
			)}
			{resultContent && showResult && (
				<TerminalOutput
					content={resultContent}
					previewLines={5}
				/>
			)}
		</ErrorBorder>
	);
}
