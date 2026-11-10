import type {ThemedToken} from "@shikijs/core";
import {useHighlightedLines} from "../../hooks/use-shiki";
import {stripMemoryTags} from "../../lib/task-checklist";
import type {ToolBodyKind} from "../../lib/tool-body-kind";
import {linkifyPlain} from "../linkify-plain";
import {InlineMarkdown} from "./inline-markdown";
import {TOOL_OUTPUT_CLAMP, TOOL_OUTPUT_REGION} from "./tool-output-region";

/** Upstream `Qx`: the most URLs one body links. */
const MAX_BODY_LINKS = 200;

/**
 * Upstream's code tile (`oS` > `Id`, the Bash command card's look): no header or line numbers, wrapped lines,
 * the code theme's background (local surface tokens, as the Bash card uses).
 */
function JsonTile({code}: {code: string}) {
	const tokens = useHighlightedLines(code, "json");
	return (
		<div className="p-px">
			<div className="epitaxy-diff epitaxy-code-card rounded-lg flex overflow-clip px-md py-xs text-code bg-surface-1 dark:bg-surface-2">
				<div className="min-w-0 flex-1">
					{tokens === null
						? code
						: tokens.map((line: ThemedToken[], lineIndex: number) => (
								<span key={lineIndex}>
									{lineIndex > 0 && "\n"}
									{line.map((token: ThemedToken, tokenIndex: number) => (
										<span key={tokenIndex} style={{color: token.color}}>
											{token.content}
										</span>
									))}
								</span>
							))}
				</div>
			</div>
		</div>
	);
}

/**
 * Upstream `aS`: a generic tool body by kind, inside the 400px "Tool output" scroller. Markdown renders with its
 * headings announced under level 3; JSON as a code tile (or `text-code` when too long or holding a secret);
 * columns text in `text-code`; plain text bare. Plain text links at most 200 URLs. The page is never RTL locally,
 * so upstream's `dir=ltr` on JSON is left out.
 */
export function ToolOutputBody({body}: {body: ToolBodyKind}) {
	return (
		<div {...TOOL_OUTPUT_REGION} className={TOOL_OUTPUT_CLAMP}>
			{body.kind === "markdown" ? (
				<div className="whitespace-normal">
					<InlineMarkdown text={stripMemoryTags(body.text)} headingsUnder={3} />
				</div>
			) : body.kind === "json" && body.tile ? (
				<JsonTile code={body.text} />
			) : (
				<div {...((body.kind === "json" || body.columns) && {className: "text-code"})}>
					{linkifyPlain(body.text, {maxLinks: MAX_BODY_LINKS})}
				</div>
			)}
		</div>
	);
}
