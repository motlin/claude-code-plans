import {inputString} from "../../lib/tool-utils";
import type {ReactNode} from "react";
import type {ThemedToken} from "@shikijs/core";
import {useHighlightedLines} from "../../hooks/use-shiki";
import type {ToolRendererProps} from "./types";
import {AnsiText, CopyButton, PolicyDenialReason, SecretRevealButton} from "./shared";
import {useSecretReveal} from "./use-secret-reveal";
import {TOOL_OUTPUT_REGION} from "./tool-output-region";
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

export function HighlightedCommand({command, language = "shellscript"}: {command: string; language?: string}) {
	const tokens = useHighlightedLines(command, language);

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
	const command = inputString(toolCall.input, "command") ?? "";
	const {isError} = toolCall;
	// A blocked call never ran, so upstream shows why in place of its raw denial text.
	const blocked = toolCall.blocked === true;
	const result = blocked ? undefined : toolCall.result;
	const resultContent = result ? stripCommandPrefix(result, command) : null;

	// Upstream's code card masks secrets until its Reveal toggle is pressed, and Copy copies what shows.
	const secrets = useSecretReveal(resultContent ? [command, resultContent] : [command]);

	const [, mcpServer, mcpTool] = MCP_CLI_RE.exec(command) ?? [];
	if (mcpServer !== undefined && mcpTool !== undefined && result) {
		return <McpCliBashRenderer toolCall={toolCall} server={mcpServer} tool={mcpTool} />;
	}

	const shownCommand = secrets.show(command);
	const copyText = resultContent ? `${shownCommand}\n${secrets.show(resultContent)}` : shownCommand;

	// Upstream's two-layer card: the prompt and command sit in an inner white
	// code card at 12/17 mono with the copy control in a rail over its top-right
	// corner; the output follows at the same size. Nested in a grouped card the
	// copy button already sits beside the body, so the card keeps even padding.
	const body = (
		<>
			{command && (
				<div
					data-bash-code-card=""
					className={`epitaxy-diff relative rounded-r6 bg-surface-1 dark:bg-surface-2 dark:ring-1 dark:ring-white/10 py-p3 pl-p6 ${nested ? "pr-p6" : "pr-[32px]"} text-[length:var(--code-size,12px)]/[var(--code-leading,17px)]`}
				>
					<HighlightedCommand command={shownCommand} />
					{!nested && (
						<div className="pointer-events-none absolute inset-y-0 right-[3px]">
							<div className="pointer-events-auto sticky top-0 flex pt-px">
								<SecretRevealButton {...secrets} size="xs" />
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
					className={`epitaxy-code-size max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all text-[length:var(--code-size,12px)]/[var(--code-leading,17px)] ${isError ? "text-danger-ink" : "text-secondary"}`}
				>
					<AnsiText content={resultContent} masked={!secrets.revealed} />
				</div>
			)}
			{blocked && <PolicyDenialReason call={toolCall} />}
		</>
	);

	// Nested in a grouped card: no card chrome, so the "Bash" header disappears
	// and the copy button sits beside the body instead of above it.
	if (nested) {
		return (
			<>
				<div className="flex-1 min-w-0 flex flex-col gap-g6 font-mono">{body}</div>
				<SecretRevealButton {...secrets} />
				<CopyButton text={copyText} />
			</>
		);
	}

	return (
		<>
			{/* Header: "Bash" label; the copy button lives in the code card */}
			<div className="flex items-center px-p6 py-p5">
				<span className="flex-1 text-body text-secondary">Bash</span>
				{!command && <SecretRevealButton {...secrets} />}
				{!command && <CopyButton text={copyText} />}
			</div>

			<div className="flex flex-col gap-g6 px-p6 pb-p8 font-mono">{body}</div>
		</>
	);
}
