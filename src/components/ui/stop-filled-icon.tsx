/**
 * Upstream's `StopFilled` Anthropicons glyph: a filled rounded square about 12px inside the 20px icon box.
 */
export function StopFilledIcon({className = "size-5"}: {className?: string}) {
	return (
		<svg viewBox="0 0 20 20" className={className} aria-hidden="true">
			<rect x="4" y="4" width="12" height="12" rx="2.5" fill="currentColor" />
		</svg>
	);
}
