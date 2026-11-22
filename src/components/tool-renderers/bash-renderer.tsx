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

/**
 * Upstream `My`: under a command, the output column beside a hover-revealed "Copy output" on its first line;
 * without a command or output (`copyText` undefined) its children sit in the parent column untouched.
 */
function BashOutputRow({copyText, children}: {copyText: string | undefined; children: ReactNode})
{
	if (copyText === undefined) return <div className="contents">{children}</div>;

	return (
		<div className="flex min-w-0 items-start gap-xs">
			<div className="flex min-w-0 flex-1 flex-col gap-md">{children}</div>
			<div className="flex h-[1lh] shrink-0 items-center pe-md">
				<ToolBodyCopyButton compact label="Copy output" text={() => copyText} />
			</div>
		</div>
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
	// Upstream `gg`: only the command (escapes shown when blocked, else CRLF normalised), without trailing space.
	const commandCopyText = (blocked ? shownCommand : maskedCommand.replaceAll("\r\n", "\n")).trimEnd();
	// The output's Copy (beside the body when there is no command) copies it without ANSI codes.
	const outputCopyText = resultContent ? stripAnsi(secrets.show(resultContent)) : "";
	// Upstream passes `alwaysVisible: tool.status === "running"`: a call whose result has not arrived yet.
	const running = !blocked && toolCall.resultUuid === undefined && toolCall.result === undefined && isError !== true;

	// Upstream `tl`: the command in the shared code tile, with the Copy command (after the local secrets Reveal) in the
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
							<ToolBodyCopyButton
								compact
								label="Copy command"
								alwaysVisible={running}
								text={() => commandCopyText}
							/>
						</>
					}
					codeFrame={
						commandNeedsFrame(shownCommand) ? (file) => <CommandFrame>{file}</CommandFrame> : undefined
					}
				/>
			)}
			<BashOutputRow copyText={command && resultContent ? outputCopyText : undefined}>
				{resultContent && (
					<div
						data-bash-output=""
						{...TOOL_OUTPUT_REGION}
						className={`max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words ${isError ? "text-danger-ink" : "text-secondary"}`}
					>
						<AnsiText content={resultContent} masked={!secrets.revealed} />
					</div>
				)}
				{blocked && <PolicyDenialReason call={toolCall} />}
			</BashOutputRow>
		</>
	);

	// Nested in a grouped card (upstream `Q`): no card chrome, so the "Bash" header disappears; only an
	// output-only body puts its Copy beside the body, as the tile holds it otherwise.
	if (nested)
	{
		return (
			<>
				<div className="flex-1 min-w-0 flex flex-col justify-center epitaxy-code-size gap-md text-code">
					{body}
				</div>
				{!command && <SecretRevealButton {...secrets} />}
				{!command && <ToolBodyCopyButton text={outputCopyText} />}
			</>
		);
	}

	return (
		<>
			{/* Header: "Bash" label; the copy button lives in the code tile */}
			<div className="flex items-center px-p6 py-p5">
				<span className="flex-1 text-body text-secondary">Bash</span>
				{!command && <SecretRevealButton {...secrets} />}
				{!command && <ToolBodyCopyButton text={outputCopyText} />}
			</div>

			<div className="flex flex-col px-md pb-lg epitaxy-code-size gap-md text-code">{body}</div>
		</>
	);
}
