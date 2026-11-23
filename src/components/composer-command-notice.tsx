/**
 * Upstream's non-blocking spawn notice footnote above the composer (cc43287c9 `Pd`), such as "isn’t a command here"
 * with its "Use /x" suggestion.
 */
export function ComposerCommandNotice({
	text,
	suggestion,
	onUse,
}: {
	text: string;
	suggestion: string | null;
	onUse: (command: string) => void;
})
{
	return (
		<div
			data-composer-command-notice
			className="mb-1.5 flex flex-wrap items-center gap-2 ps-1 text-footnote text-upstream-warning select-text"
		>
			<span>{text}</span>
			{suggestion !== null && (
				<button
					type="button"
					className="inline-flex h-5 items-center rounded-r5 bg-fill-secondary px-1.5 text-footnote text-primary shadow-field-drop hover:bg-fill-secondary-hover focus-visible:shadow-focus focus-visible:outline-hidden"
					onClick={() =>
					{
						onUse(suggestion);
					}}
				>
					{`Use /${suggestion}`}
				</button>
			)}
		</div>
	);
}
