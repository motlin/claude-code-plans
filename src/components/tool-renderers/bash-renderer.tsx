import type {ThemedToken} from '@shikijs/core';
import {useHighlightedLines} from '../../hooks/use-shiki';
import type {ToolRendererProps} from './types';
import {AnsiText, CopyButton, ErrorBorder, ExpandableBlock} from './shared';
import {getMcpRenderer} from './mcp-registry';

const MCP_CLI_RE = /^mcp-cli\s+call\s+(\S+)\s+(\S+)/;

function stripCommandPrefix(content: string, command: string): string {
	const prefix = `$ ${command}\n`;
	if (content.startsWith(prefix)) {
		return content.slice(prefix.length);
	}
	return content;
}

function stripExitCode(content: string): {exitCode: number | null; text: string} {
	const match = content.match(/^Exit code (\d+)\n?/);
	if (match?.[1]) {
		return {
			exitCode: parseInt(match[1], 10),
			text: content.replace(/^Exit code \d+\n?/, ''),
		};
	}
	return {exitCode: null, text: content};
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

function HighlightedCommand({command}: {command: string}) {
	const tokens = useHighlightedLines(command, 'shellscript');

	if (!tokens) {
		return <div className="whitespace-pre-wrap">$ {command}</div>;
	}

	return (
		<div className="whitespace-pre-wrap">
			<span>$ </span>
			{tokens.map((lineTokens: ThemedToken[], lineIndex: number) => (
				<span key={lineIndex}>
					{lineIndex > 0 && '\n'}
					{lineTokens.map((token: ThemedToken, tokenIndex: number) => (
						<span
							key={tokenIndex}
							style={{color: token.color}}
						>
							{token.content}
						</span>
					))}
				</span>
			))}
		</div>
	);
}

export function BashRenderer({toolCall}: ToolRendererProps) {
	const command = (toolCall.input['command'] as string) ?? '';
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

	const {exitCode, text: outputText} = resultContent ? stripExitCode(resultContent) : {exitCode: null, text: ''};

	const outputLineCount = outputText ? outputText.split('\n').length : 0;
	const copyText = outputText ? `$ ${command}\n${outputText}` : `$ ${command}`;

	return (
		<ErrorBorder isError={isError}>
			{/* Header: "Bash" label + hover copy button */}
			<div className="flex items-center px-p6 py-p5">
				<span className="flex-1 text-body text-assistant-secondary">Bash</span>
				<CopyButton text={copyText} />
			</div>

			{/* Body: command + output in mono text-code */}
			<div className="flex flex-col gap-g8 px-p6 pb-p8 text-code font-mono">
				{exitCode !== null && (
					<span className="inline-flex items-center gap-1.5 self-start bg-danger-900 text-danger-000 px-2.5 py-1 rounded text-xs font-bold">
						Exit code <span className="font-mono">{exitCode}</span>
					</span>
				)}
				{command && <HighlightedCommand command={command} />}
				{outputText && (
					<ExpandableBlock
						lineCount={outputLineCount}
						maxLines={20}
					>
						<div className="whitespace-pre-wrap break-all text-assistant-secondary">
							<AnsiText content={outputText} />
						</div>
					</ExpandableBlock>
				)}
			</div>
		</ErrorBorder>
	);
}
