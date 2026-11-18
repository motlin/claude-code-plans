import {type SyntheticEvent, useState} from "react";

import
{
	markThumbFailed,
	type PaletteThumb,
	preferredThumbSrc,
	recordThumbLoaded,
	thumbFailed,
	thumbKey,
	useFailedThumbSrcs,
} from "../lib/palette-thumb-store";

/** Upstream's `Pt`: a load or error event for a src the img has already moved past. */
function isStale(img: HTMLImageElement): boolean
{
	return img.currentSrc !== "" && img.currentSrc !== img.src;
}

/**
 * Upstream's `Ft`: the ⌘K thumb card and row-actions header image. An error falls back from the dark src to the
 * light one once; after that the thumb fails for good, the img unmounts and `onFailed` runs.
 */
export function PaletteThumbImage({
	thumb,
	onLoaded,
	onFailed,
}: {
	thumb: PaletteThumb;
	onLoaded?: () => void;
	onFailed?: () => void;
})
{
	const failed = useFailedThumbSrcs();
	const preferred = preferredThumbSrc(thumb, failed);
	const [src, setSrc] = useState(preferred);
	const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
	const [lastPreferred, setLastPreferred] = useState(preferred);
	if (preferred !== lastPreferred)
	{
		// A new thumb restarts from its preferred src, unless the loaded picture is already this thumb's.
		setLastPreferred(preferred);
		const {fallbackSrc} = thumb;
		setSrc((current) =>
			current === loadedSrc &&
			(thumbKey(current) === thumbKey(preferred) ||
				(fallbackSrc !== undefined && thumbKey(current) === thumbKey(fallbackSrc)))
				? current
				: preferred,
		);
	}
	if (thumbFailed(thumb, failed)) return null;

	function handleLoad(event: SyntheticEvent<HTMLImageElement>)
	{
		if (isStale(event.currentTarget)) return;
		recordThumbLoaded(src);
		setLoadedSrc(src);
		onLoaded?.();
	}

	function handleError(event: SyntheticEvent<HTMLImageElement>)
	{
		if (isStale(event.currentTarget)) return;
		const {fallbackSrc} = thumb;
		const fallBack = fallbackSrc !== undefined && src !== fallbackSrc && !failed.has(fallbackSrc);
		markThumbFailed(src);
		if (fallBack)
		{
			setSrc(fallbackSrc);
			return;
		}
		onFailed?.();
	}

	return (
		<img
			alt=""
			src={src}
			referrerPolicy="no-referrer"
			decoding="sync"
			draggable={false}
			data-testid="palette-thumb-image"
			className="block aspect-[16/10] w-full rounded object-cover object-top"
			onLoad={handleLoad}
			onError={handleError}
		/>
	);
}
