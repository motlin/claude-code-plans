import type {ReactNode} from "react";
import type {ThemedToken} from "@shikijs/core";
import {useHighlightedLines} from "../../hooks/use-shiki";
import type {ToolRendererProps} from "./types";
import {AnsiText, CopyButton, TOOL_OUTPUT_REGION} from "./shared";
import {getMcpRenderer} from "./mcp-registry";

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
	toolCall: ToolRendererProps["toolCall"];
	server: string;
	tool: string;
}) {
	const syntheticName = `mcp__${server}__${tool}`;
	const Renderer = getMcpRenderer(server);

	return <Renderer toolCall={{...toolCall, name: syntheticName}} />;
}

// The prompt is a select-none gutter beside the command column, so copying the
// rendered text yields the bare command and wrapped lines stay left-aligned
// under the command rather than under the `$`.
function CommandRow({children}: {children: ReactNode}) {
	return (
		<div className="flex">
			<span className="select-none text-secondary">$&nbsp;</span>
			<div className="min-w-0 flex-1 whitespace-pre-wrap">{children}</div>
		</div>
	);
}

export function HighlightedCommand({command}: {command: string}) {
	const tokens = useHighlightedLines(command, "shellscript");

	if (!tokens) {
		return <CommandRow>{command}</CommandRow>;
	}

	return (
		<CommandRow>
			{tokens.map((lineTokens: ThemedToken[], lineIndex: number) => (
				<span key={lineIndex}>
					{lineIndex > 0 && "\n"}
					{lineTokens.map((token: ThemedToken, tokenIndex: number) => (
						<span key={tokenIndex} style={{color: token.color}}>
							{token.content}
						</span>
					))}
				</span>
			))}
		</CommandRow>
	);
}

export function BashRenderer({toolCall, nested = false}: ToolRendererProps) {
	const command = (toolCall.input["command"] as string) ?? "";
	const {result, isError} = toolCall;
	const resultContent = result ? stripCommandPrefix(result, command) : null;

	const mcpMatch = MCP_CLI_RE.exec(command);
	if (mcpMatch && result) {
		return <McpCliBashRenderer toolCall={toolCall} server={mcpMatch[1]!} tool={mcpMatch[2]!} />;
	}

	const copyText = resultContent ? `${command}\n${resultContent}` : command;

	// Upstream's two-layer card: the prompt and command sit in an inner white
	// code card at 12/17 mono with the copy control in a rail over its top-right
	// corner; the output follows at the same size. Nested in a grouped card the
	// copy button already sits beside the body, so the card keeps even padding.
	const body = (
		<>
			{command && (
				<div
					data-bash-code-card=""
					className={`relative rounded-r6 bg-surface-1 py-p3 pl-p6 ${nested ? "pr-p6" : "pr-[32px]"} text-[12px]/[17px]`}
				>
					<HighlightedCommand command={command} />
					{!nested && (
						<div className="pointer-events-none absolute inset-y-0 right-[3px]">
							<div className="pointer-events-auto sticky top-0 pt-px">
								<CopyButton text={copyText} size="xs" />
							</div>
						</div>
					)}
				</div>
			)}
			{resultContent && (
				<div
					data-bash-output=""
					{...TOOL_OUTPUT_REGION}
					className={`max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all text-[12px]/[17px] ${isError ? "text-danger-ink" : "text-secondary"}`}
				>
					<AnsiText content={resultContent} />
				</div>
			)}
		</>
	);

	// Nested in a grouped card: no card chrome, so the "Bash" header disappears
	// and the copy button sits beside the body instead of above it.
	if (nested) {
		return (
			<>
				<div className="flex-1 min-w-0 flex flex-col gap-g6 font-mono">{body}</div>
				<CopyButton text={copyText} />
			</>
		);
	}

	return (
		<>
			{/* Header: "Bash" label; the copy button lives in the code card */}
			<div className="flex items-center px-p6 py-p5">
				<span className="flex-1 text-body text-secondary">Bash</span>
				{!command && <CopyButton text={copyText} />}
			</div>

			<div className="flex flex-col gap-g6 px-p6 pb-p8 font-mono">{body}</div>
		</>
	);
}
