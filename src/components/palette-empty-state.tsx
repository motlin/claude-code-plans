import type {PaletteEmptyKind} from "../lib/palette-empty";

/** Upstream's cds Kbd keycap: 18px tall, min 18px wide, 3px padding, 4px radius, transparent fill. */
const KEYCAP_CLASS =
	"text-caption inline-flex shrink-0 items-center justify-center h-[calc(1em+6px)] min-w-[calc(1em+6px)] px-[3px] rounded-r3 [color:var(--shortcut-cap-ink)] bg-transparent border border-[color:var(--shortcut-cap-line)] [font-family:inherit] [font-variation-settings:inherit] [line-height:1]";

/**
 * Upstream's cds Button `variant="secondary" size="sm"` at default density: 20px tall, 6px padding,
 * 5px radius (comfortable density is 28px / 10px / 7px), secondary fill with the field shadow.
 */
const SEARCH_ALL_CLASS =
	"h-5 rounded-r4 px-1.5 text-sm text-primary bg-fill-secondary shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)] transition-shadow hover:bg-fill-secondary-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * The palette's no-results block, a port of upstream's `rr`: centred copy plus "Search all" when
 * filters emptied the list, or the "Tab to compose" hint otherwise. "silent" renders nothing.
 */
export function PaletteEmptyState({
	kind,
	message,
	onSearchAll,
	onCompose,
}: {
	kind: PaletteEmptyKind;
	message: string;
	onSearchAll: () => void;
	onCompose: () => void;
}) {
	if (kind === "silent") return null;
	return (
		<div
			data-palette-empty=""
			className="flex min-h-fit flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
		>
			<p aria-hidden="true" className="m-0 max-w-full break-words text-secondary">
				{message}
			</p>
			{kind === "filtered" ? (
				<button
					type="button"
					// Keep focus in the palette input, as upstream does.
					onMouseDown={(event) => {
						event.preventDefault();
					}}
					onClick={onSearchAll}
					className={SEARCH_ALL_CLASS}
				>
					Search all
				</button>
			) : (
				<p aria-hidden="true" className="m-0 flex items-center gap-1.5 text-muted-as-secondary">
					<button
						type="button"
						tabIndex={-1}
						onClick={onCompose}
						className="pointer-events-auto disabled:opacity-50"
					>
						<kbd data-cds="Kbd" className={KEYCAP_CLASS}>
							Tab
						</kbd>
					</button>{" "}
					to compose
				</p>
			)}
		</div>
	);
}
