import type {ToolRendererProps} from './types';
import {ErrorBorder, TerminalOutput} from './shared';
import {getMcpRenderer} from './mcp-registry';

const MCP_CLI_RE = /^mcp-cli\s+call\s+(\S+)\s+(\S+)/;

function stripCommandPrefix(content: string, command: string): string {
	const prefix = `$ ${command}\n`;
	if (content.startsWith(prefix)) {
		return content.slice(prefix.length);
	}
	return content;
}

function McpCliBashRenderer({
	toolCall,
	server,
	tool,
}: {
	toolCall: ToolRendererProps['toolCall'];
	server: string;
	tool: string;
}) {
	const syntheticName = `mcp__${server}__${tool}`;
	const Renderer = getMcpRenderer(server);

	return (
		<ErrorBorder isError={toolCall.isError}>
			<Renderer toolCall={{...toolCall, name: syntheticName}} />
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
		return (
			<McpCliBashRenderer
				toolCall={toolCall}
				server={mcpMatch[1]!}
				tool={mcpMatch[2]!}
			/>
		);
	}

	return (
		<ErrorBorder isError={isError}>
			{description && <div className="text-xs text-text-500 mb-1">{description}</div>}
			{resultContent && <TerminalOutput content={resultContent} />}
		</ErrorBorder>
	);
}
