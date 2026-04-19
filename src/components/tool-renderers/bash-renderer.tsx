import type {ToolRendererProps} from './types';
import {ErrorBorder, TerminalOutput} from './shared';
import {getToolRenderer} from './index';

const MCP_CLI_RE = /^mcp-cli\s+call\s+(\S+)\s+(\S+)/;

function stripCommandPrefix(content: string, command: string): string {
	const prefix = `$ ${command}\n`;
	if (content.startsWith(prefix)) {
		return content.slice(prefix.length);
	}
	return content;
}

function CommandHeader({command, description}: {command: string; description?: string}) {
	return (
		<div className="bg-bg-200 rounded px-2 py-1.5 mb-1">
			{description && <div className="text-xs text-text-500 mb-0.5">{description}</div>}
			<div className="font-mono text-xs">
				<span className="text-text-500">$ </span>
				<span className="text-success-000">{command}</span>
			</div>
		</div>
	);
}

function McpCliBashRenderer({
	toolCall,
	command,
	description,
	server,
	tool,
}: {
	toolCall: ToolRendererProps['toolCall'];
	command: string;
	description?: string;
	server: string;
	tool: string;
}) {
	const syntheticName = `mcp__${server}__${tool}`;
	const Renderer = getToolRenderer(syntheticName);

	return (
		<ErrorBorder isError={toolCall.isError}>
			<CommandHeader {...(description ? {command, description} : {command})} />
			<div className="mt-1">
				<Renderer toolCall={{...toolCall, name: syntheticName}} />
			</div>
		</ErrorBorder>
	);
}

export function BashRenderer({toolCall}: ToolRendererProps) {
	const command = (toolCall.input['command'] as string) ?? '';
	const description = toolCall.input['description'] as string | undefined;
	const {result, isError} = toolCall;
	const resultContent = result ? stripCommandPrefix(result, command) : null;

	const mcpMatch = MCP_CLI_RE.exec(command);
	if (mcpMatch && result) {
		const mcpProps: Parameters<typeof McpCliBashRenderer>[0] = {
			toolCall,
			command,
			server: mcpMatch[1]!,
			tool: mcpMatch[2]!,
		};
		if (description) mcpProps.description = description;
		return <McpCliBashRenderer {...mcpProps} />;
	}

	const headerProps: {command: string; description?: string} = {command};
	if (description) headerProps.description = description;

	return (
		<ErrorBorder isError={isError}>
			<CommandHeader {...headerProps} />
			{resultContent && <TerminalOutput content={resultContent} />}
		</ErrorBorder>
	);
}
