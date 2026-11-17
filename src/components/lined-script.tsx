/** Upstream's line span: the number drawn in a 4.5ch end-aligned gutter from `data-line`. */
const LINE_CLASS =
	"relative block ps-[6ch] before:absolute before:start-0 before:w-[4.5ch] before:text-end before:text-muted-as-secondary before:select-none before:content-[attr(data-line)]";

/**
 * Upstream's lined script view (cc32965c2 `Jb`, was `Cb`): a permission card fold's text with a line-number gutter.
 * The closing newline doesn't make an empty last line, but the last line keeps it. The copy has already shown the
 * text's invisible characters (`visibleMultiline`).
 */
export function LinedScript({script}: {script: string})
{
	const closed = script.endsWith("\n");
	const lines = script.replace(/\n$/, "").split("\n");
	return (
		<pre
			dir="ltr"
			className="py-md pe-lg text-code text-secondary whitespace-break-spaces break-words select-text [unicode-bidi:bidi-override]"
		>
			{lines.map((line, index) => (
				// oxlint-disable-next-line react/no-array-index-key -- a line is its position
				<span key={index} data-line={index + 1} className={LINE_CLASS}>
					{line}
					{index < lines.length - 1 || closed ? "\n" : null}
				</span>
			))}
		</pre>
	);
}
