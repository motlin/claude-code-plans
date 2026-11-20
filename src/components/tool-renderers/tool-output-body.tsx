import {pageIsRtl} from "../../lib/page-direction";
import {stripMemoryTags} from "../../lib/task-checklist";
import type {ToolBodyKind} from "../../lib/tool-body-kind";
import {CodeTile} from "../code-tile";
import {linkifyToolText} from "../linkify-plain";
import {InlineMarkdown} from "./inline-markdown";
import {PlainText} from "./plain-text";
import {TOOL_OUTPUT_CLAMP, TOOL_OUTPUT_REGION} from "./tool-output-region";

/** Upstream `Wv`: JSON in the shared code tile, with no leading element. */
function JsonTile({code}: {code: string})
{
	return (
		<div className="p-px">
			<CodeTile code={code} lang="json" />
		</div>
	);
}

/**
 * Upstream `Vv` (was `aS`): a generic tool body by kind, inside the 400px "Tool output" scroller. Markdown renders
 * with its headings announced under level 3; JSON as a code tile (or `text-code`, left-to-right on an RTL page,
 * when too long or holding a secret); columns text in `text-code`; plain text bare. Non-markdown text goes through
 * the transcript's plain renderer: ANSI painted, secrets cloaked, and plain runs linking at most 200 URLs.
 */
export function ToolOutputBody({body}: {body: ToolBodyKind})
{
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
					{...((json || body.columns) &&
					{
						className: "text-code",
					})}
					{...(json &&
						pageIsRtl() &&
						{
							dir: "ltr",
						})}
				>
					<PlainText renderPlain={linkifyToolText}>{body.text}</PlainText>
				</div>
			)}
		</div>
	);
}
