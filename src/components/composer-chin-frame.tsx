import type {ComponentPropsWithoutRef, ReactNode} from "react";
import
{
	CHIN_LEADING_LESS_ROW_CLASS,
	CHIN_LEADING_LESS_TRAILING_CLASS,
	COMPOSER_CHIN_FRAME_CLASS,
	COMPOSER_CHIN_GRID_CLASS,
	COMPOSER_CHIN_LEADING_CLASS,
	COMPOSER_CHIN_ROW_CLASS,
	COMPOSER_CHIN_SLIDE_CLASS,
	COMPOSER_CHIN_TRAILING_CLASS,
} from "./composer-tokens";

interface ComposerChinFrameProps extends Omit<ComponentPropsWithoutRef<"div">, "children" | "className">
{
	/** Upstream's `open`: closed collapses the row to nothing, fades it and makes it inert. Defaults to open. */
	open?: boolean;
	leading?: ReactNode;
	trailing?: ReactNode;
	children?: ReactNode;
}

/**
 * Upstream's ChatComposerChin (`rp`): the frame, its collapse grid, the slide and the `data-size="xs"` touch-size row
 * holding the leading slot, any bare children and the trailing slot. Like upstream web, no caller closes it today.
 */
export function ComposerChinFrame({open = true, leading, trailing, children, ...rest}: ComposerChinFrameProps)
{
	const hasLeading = leading !== undefined && leading !== null;
	const hasTrailing = trailing !== undefined && trailing !== null;
	const rowClass = [
		COMPOSER_CHIN_ROW_CLASS,
		!hasLeading && CHIN_LEADING_LESS_ROW_CLASS,
		hasLeading || hasTrailing ? "justify-between" : "justify-center",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div data-cds="ChatComposerChin" aria-hidden={!open} className={COMPOSER_CHIN_FRAME_CLASS} {...rest}>
			<div className={`${COMPOSER_CHIN_GRID_CLASS} ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
				<div
					className={`${COMPOSER_CHIN_SLIDE_CLASS} ${
						open ? "translate-none opacity-100" : "-translate-y-2 opacity-0"
					}`}
					inert={!open || undefined}
				>
					<div data-chin-row="" data-size="xs" data-touch-size="" className={rowClass}>
						{hasLeading && <div className={COMPOSER_CHIN_LEADING_CLASS}>{leading}</div>}
						{children}
						{hasTrailing && (
							<div
								data-cds-part="chin-trailing"
								className={
									hasLeading
										? COMPOSER_CHIN_TRAILING_CLASS
										: `${COMPOSER_CHIN_TRAILING_CLASS} ${CHIN_LEADING_LESS_TRAILING_CLASS}`
								}
							>
								{trailing}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
