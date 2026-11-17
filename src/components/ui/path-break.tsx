/** Each piece ends after a `/` or `\`, so the path can only wrap at its separators. */
const SEPARATOR_END = /(?<=[\\/])/;

/**
 * Upstream's path tooltip text (shared `ch`): a left-to-right path split after each separator into inline blocks,
 * so a long path wraps between folders rather than mid-name.
 */
export function PathBreak({path}: {path: string})
{
	return (
		<span dir="ltr">
			{path.split(SEPARATOR_END).map((piece, index) => (
				// oxlint-disable-next-line react/no-array-index-key -- the pieces are a fixed split of one path; repeated folder names would collide on their text
				<span key={index} className="inline-block max-w-full whitespace-pre-wrap">
					{piece}
				</span>
			))}
		</span>
	);
}
