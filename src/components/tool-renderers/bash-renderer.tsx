import {inputString} from "../../lib/tool-utils";
import type {ReactNode} from "react";
import type {ThemedToken} from "@shikijs/core";
import {useHighlightedLines} from "../../hooks/use-shiki";
import type {ToolRendererProps} from "./types";
import {stripAnsi} from "../../lib/ansi-codes";
import {visibleMultiline} from "../../lib/visible-text";
import {commandNeedsFrame} from "../../lib/code-tile";
import {CommandCodeTile, CommandFrame} from "../code-tile";
import {AnsiText, PolicyDenialReason, SecretRevealButton, ToolBodyCopyButton} from "./shared";
import {useSecretReveal} from "./use-secret-reveal";
import {TOOL_OUTPUT_REGION} from "./tool-output-region";
import {getMcpRenderer} from "./mcp-registry";

const MCP_CLI_RE = /^mcp-cli\s+call\s+(\S+)\s+(\S+)/;

function stripCommandPrefix(content: string, command: string): string
{
	const prefix = `$ ${command}\n`;
	if (content.startsWith(prefix))
	{
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
})
{
	const syntheticName = `mcp__${server}__${tool}`;
	const Renderer = getMcpRenderer(server);

	return (
		<Renderer
			toolCall={
			{
				...toolCall,
				name: syntheticName,
			}}
		/>
	);
}

// The prompt is a select-none gutter beside the command column, so copying the
// rendered text yields the bare command and wrapped lines stay left-aligned
// under the command rather than under the `$`.
/** Upstream `Rd`: the prompt glyph, `>` for powershell and `$` otherwise, hidden from screen readers and in-app Find. */
function CommandRow({children, language}: {children: ReactNode; language: string})
{
	return (
		<div className="flex">
			<span aria-hidden="true" data-find-omitted="" className="select-none text-secondary">
				{language === "powershell" ? ">" : "$"}&nbsp;
			</span>
			<div className="min-w-0 flex-1 whitespace-pre-wrap">{children}</div>
		</div>
	);
}

/** A command's shell-highlighted text, without the prompt (plain text until the highlighter loads). */
export function CommandTokens({command, language = "shellscript"}: {command: string; language?: string})
{
	const tokens = useHighlightedLines(command, language);

	if (!tokens) return command;

	return tokens.map((lineTokens: ThemedToken[], lineIndex: number) => (
		<span key={lineIndex}>
			{lineIndex > 0 && "\n"}
			{lineTokens.map((token: ThemedToken, tokenIndex: number) => (
				<span
					key={tokenIndex}
					style={
					{
						color: token.color,
					}}
				>
					{token.content}
				</span>
			))}
		</span>
	));
}

export function HighlightedCommand({command, language = "shellscript"}: {command: string; language?: string})
{
	return (
		<CommandRow language={language}>
			<CommandTokens command={command} language={language} />
		</CommandRow>
	);
}

export function BashRenderer({toolCall, nested = false}: ToolRendererProps)
{
	const command = inputString(toolCall.input, "command") ?? "";
	const {isError} = toolCall;
	// A blocked call never ran, so upstream shows why in place of its raw denial text.
	const blocked = toolCall.blocked === true;
	const result = blocked ? undefined : toolCall.result;
	const resultContent = result ? stripCommandPrefix(result, command) : null;

	// Upstream's code card masks secrets until its Reveal toggle is pressed, and Copy copies what shows.
	const secrets = useSecretReveal(resultContent ? [command, resultContent] : [command]);

	const [, mcpServer, mcpTool] = MCP_CLI_RE.exec(command) ?? [];
	if (mcpServer !== undefined && mcpTool !== undefined && result)
	{
		return <McpCliBashRenderer toolCall={toolCall} server={mcpServer} tool={mcpTool} />;
	}

	// Upstream `Cm`: a policy-blocked command shows its invisible and control characters (`SO`).
	const maskedCommand = secrets.show(command);
	const shownCommand = blocked ? visibleMultiline(maskedCommand) : maskedCommand;
	// Upstream `Dm`: the prompt and command, a blank line, then the output without its ANSI codes.
	const copyText = [command ? `$ ${shownCommand}` : "", resultContent ? stripAnsi(secrets.show(resultContent)) : ""]
		.filter(Boolean)
		.join("\n\n");

	// Upstream `tl`: the command in the shared code tile, with the Copy (after the local secrets Reveal) in the
	// tile's first-line action column; a long command scrolls in the 10.5-line Command frame.
	const body = (
		<>
			{command && (
				<CommandCodeTile
					command={shownCommand}
					lang="bash"
					action={
						<>
							<SecretRevealButton {...secrets} size="xs" />
							<ToolBodyCopyButton compact text={() => copyText} />
						</>
					}
					codeFrame={
						commandNeedsFrame(shownCommand) ? (file) => <CommandFrame>{file}</CommandFrame> : undefined
					}
				/>
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

	// Nested in a grouped card (upstream `Q`): no card chrome, so the "Bash" header disappears; only an
	// output-only body puts its Copy beside the body, as the tile holds it otherwise.
	if (nested)
	{
		return (
			<>
				<div className="flex-1 min-w-0 flex flex-col gap-g6 font-mono">{body}</div>
				{!command && <SecretRevealButton {...secrets} />}
				{!command && <ToolBodyCopyButton text={copyText} />}
			</>
		);
	}

	return (
		<>
			{/* Header: "Bash" label; the copy button lives in the code tile */}
			<div className="flex items-center px-p6 py-p5">
				<span className="flex-1 text-body text-secondary">Bash</span>
				{!command && <SecretRevealButton {...secrets} />}
				{!command && <ToolBodyCopyButton text={copyText} />}
			</div>

			<div className="flex flex-col gap-g6 px-p6 pb-p8 font-mono">{body}</div>
		</>
	);
}
