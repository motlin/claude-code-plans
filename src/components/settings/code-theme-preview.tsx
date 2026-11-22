import {codeLeadingPx, DEFAULT_CODE_FONT_SIZE, type CodeFontSize, type CodeThemeId} from "../../lib/code-themes";
import {buildUnifiedHunk} from "../../lib/diff-utils";
import {InlinePatchDiff} from "../tool-renderers/inline-diff";

/** Upstream's Code appearance sample: one line removed, one added, each with its changed word. */
const PREVIEW_PATCH = buildUnifiedHunk(
	'function greet(name: string) {\n  return "Hello, " + name;\n}',
	"function greet(name: string) {\n  return `Hello, ${name}!`;\n}",
	"greet.ts",
);

/**
 * A live diff card rendered in `theme`, shown under its picker: upstream cda9efc49's pierre FileDiff through
 * `ne()` = `Q(true, false)`, so change rails and hidden signs, never the add button. Its `epitaxy-codeblock`
 * wrapper takes Settings ▸ Code font size, and the min-height is upstream `JG`: 4 code lines + 18px.
 */
export function CodeThemePreview({
	theme,
	label,
	codeFontSize,
}: {
	theme: CodeThemeId;
	label: string;
	codeFontSize: CodeFontSize | null;
})
{
	const minHeight = `${4 * codeLeadingPx(codeFontSize ?? DEFAULT_CODE_FONT_SIZE) + 18}px`;

	return (
		<div className="epitaxy-codeblock overflow-clip rounded-lg border">
			<figure
				aria-label={label}
				data-code-theme={theme}
				style={
				{
					minHeight,
				}}
				className="m-0 font-mono text-code leading-[var(--code-leading,20px)]"
			>
				<InlinePatchDiff patch={PREVIEW_PATCH} theme={theme} />
			</figure>
		</div>
	);
}
