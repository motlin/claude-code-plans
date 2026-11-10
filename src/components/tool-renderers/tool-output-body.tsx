import type {ThemedToken} from "@shikijs/core";
import type {ReactNode} from "react";
import {useCodeThemeBackground} from "../../hooks/use-code-theme-background";
import {useHighlightedLines} from "../../hooks/use-shiki";
import {stripMemoryTags} from "../../lib/task-checklist";
import type {ToolBodyKind} from "../../lib/tool-body-kind";
import {linkifyPlain} from "../linkify-plain";
import {InlineMarkdown} from "./inline-markdown";
import {PlainText} from "./plain-text";
import {TOOL_OUTPUT_CLAMP, TOOL_OUTPUT_REGION} from "./tool-output-region";

/** Upstream `Qx`: the most URLs one body links. */
const MAX_BODY_LINKS = 200;

/**
 * Upstream's code tile (`Hv` > `$c`, the Bash command card's look): no header or line numbers, wrapped lines,
 * always left-to-right, on the code theme's background (`Zr`).
 */
function JsonTile({code}: {code: string}) {
	const tokens = useHighlightedLines(code, "json");
	const background = useCodeThemeBackground();
	return (
		<div className="p-px">
			<div
				dir="ltr"
				className="epitaxy-diff epitaxy-code-card rounded-lg flex overflow-clip px-md py-xs text-code"
				style={{background}}
			>
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

/** Upstream `Fv` (`eS`): a plain run's URLs as links that ask before leaving, at most 200 of them. */
function linkifyBody(text: string): ReactNode {
	return linkifyPlain(text, {maxLinks: MAX_BODY_LINKS});
}

/** Upstream `p() === "rtl"`: the page's direction, read off the root element. */
function pageIsRtl(): boolean {
	return document.documentElement.dir === "rtl";
}

/**
 * Upstream `Vv` (was `aS`): a generic tool body by kind, inside the 400px "Tool output" scroller. Markdown renders
 * with its headings announced under level 3; JSON as a code tile (or `text-code`, left-to-right on an RTL page,
 * when too long or holding a secret); columns text in `text-code`; plain text bare. Non-markdown text goes through
 * the transcript's plain renderer: ANSI painted, secrets cloaked, and plain runs linking at most 200 URLs.
 */
export function ToolOutputBody({body}: {body: ToolBodyKind}) {
	const json = body.kind === "json";
	return (
		<div {...TOOL_OUTPUT_REGION} className={TOOL_OUTPUT_CLAMP}>
			{body.kind === "markdown" ? (
				<div className="whitespace-normal">
					<InlineMarkdown text={stripMemoryTags(body.text)} headingsUnder={3} />
				</div>
			) : body.kind === "json" && body.tile ? (
				<JsonTile code={body.text} />
			) : (
				<div
					{...((json || body.columns) && {className: "text-code"})}
					{...(json && pageIsRtl() && {dir: "ltr"})}
				>
					<PlainText renderPlain={linkifyBody}>{body.text}</PlainText>
				</div>
			)}
		</div>
	);
}
