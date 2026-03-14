import type {ToolRendererProps} from './types';
import {TerminalOutput} from './shared';

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

	return (
		<div className={isError ? 'border-l-2 border-red-500 pl-2' : ''}>
			<div className="bg-muted rounded px-2 py-1.5 mb-1">
				{description && <div className="text-xs text-muted-foreground mb-0.5">{description}</div>}
				<div className="font-mono text-xs">
					<span className="text-muted-foreground">$ </span>
					<span className="text-green-700 dark:text-green-400">{command}</span>
				</div>
			</div>
			{result && <TerminalOutput content={stripCommandPrefix(result, command)} />}
		</div>
	);
}
