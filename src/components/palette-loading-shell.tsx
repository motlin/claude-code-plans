import {Dialog} from "@base-ui/react/dialog";
import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {PaletteLoadingSkeleton} from "./palette-loading-skeleton";
import {PALETTE_POPUP_CLASS, PALETTE_POPUP_STYLE, PALETTE_RADIUS, paletteBackdropClass} from "./palette-shell-classes";
import {DialogPopup} from "./ui/dialog-popup";
import type {PaletteMode} from "../hooks/use-command-palette";
import {appendPaletteKey, backspacePaletteKey, clearPaletteKeys} from "../lib/palette-keystroke-buffer";
import {isPhoneViewport, paletteLoadingVariant, setPaletteLoadingShown} from "../lib/palette-loading";

/**
 * Upstream's buffer listener (`V8`/`hC`): while the palette module loads, a printable key or Backspace is kept for
 * the opening view instead of reaching the page; modified keys, IME composition and other keys pass through.
 */
function bufferKey(event: KeyboardEvent): void
{
	if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
	if (event.key.length === 1)
	{
		event.preventDefault();
		appendPaletteKey(event.key);
	}
	else if (event.key === "Backspace")
	{
		event.preventDefault();
		backspacePaletteKey();
	}
}

/**
 * The palette's dialog shell (upstream's eager `m8`) around its cold-load skeleton (`v8`), drawn while the palette
 * module downloads. Focus moves into the dialog at once (upstream `Wz`) so typing lands in the key buffer.
 */
export function PaletteLoadingShell({
	open,
	onOpenChange,
	mode,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: PaletteMode;
})
{
	const popupRef = useRef<HTMLDivElement>(null);
	// Upstream reads the phone test once, at mount.
	const [phone] = useState(isPhoneViewport);

	// The flag outlives the shell: the palette's portal content mounts only after the shell is gone, and the
	// palette clears it when this open ends.
	useLayoutEffect(() =>
	{
		clearPaletteKeys();
		setPaletteLoadingShown(true);
	}, []);

	useEffect(() =>
	{
		document.addEventListener("keydown", bufferKey);
		return () =>
		{
			document.removeEventListener("keydown", bufferKey);
		};
	}, []);

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) =>
			{
				// Upstream clears the buffer on the open → closed edge.
				if (!next)
				{
					clearPaletteKeys();
					setPaletteLoadingShown(false);
				}
				onOpenChange(next);
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className={paletteBackdropClass(false)} />
				<DialogPopup
					unstyled
					ref={popupRef}
					data-command-palette=""
					data-palette-loading-shell=""
					initialFocus={popupRef}
					className={PALETTE_POPUP_CLASS}
					style={PALETTE_POPUP_STYLE}
				>
					<Dialog.Title className="sr-only">Search</Dialog.Title>
					<div
						className={`relative overflow-hidden border-[0.5px] border-strong bg-surface-3 shadow-2xl ${PALETTE_RADIUS}`}
					>
						<PaletteLoadingSkeleton variant={paletteLoadingVariant(mode, phone)} />
					</div>
				</DialogPopup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
