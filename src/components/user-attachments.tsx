import {lazy, Suspense, useState, type SyntheticEvent} from "react";

import {ImageContextMenu} from "./image-context-menu";

// The viewer loads only when a tile opens, keeping its dialog out of the session chunk.
const ImageViewer = lazy(async () =>
	import("./image-viewer").then((module) => (
	{
		default: module.ImageViewer,
	})),
);

/** One image attached to a user message: pasted (a data URL) or referenced by path. */
export interface AttachedImage
{
	key: string;
	src: string;
	/** What the image is, for the viewer and the tile's control. */
	label: string;
	/** The file a referenced image was read from: its menus add the file actions. */
	path?: string;
}

function hideFailedTile(event: SyntheticEvent<HTMLImageElement>): void
{
	const tile = event.currentTarget.closest<HTMLElement>("[data-attachment-tile]");
	if (tile !== null) tile.style.display = "none";
}

/**
 * Upstream's attachments strip above a user bubble: natural-size image tiles,
 * right-aligned and wrapping, two or more halving to 240px wide. A tile opens
 * the image viewer, morphing out of (and back into) that tile.
 */
export function UserAttachments({
	images,
	sessionId,
}: {
	images: readonly AttachedImage[];
	/** The session a referenced image's Attach as context goes to. */
	sessionId?: string | undefined;
})
{
	const [viewing, setViewing] = useState<number | null>(null);
	const [origin, setOrigin] = useState<HTMLElement | null>(null);
	if (images.length === 0) return null;
	return (
		<div data-attachments="" className="attachment-strip">
			{images.map((image, index) =>
			{
				const open = (event: SyntheticEvent<HTMLElement>) =>
				{
					setOrigin(event.currentTarget);
					setViewing(index);
				};
				return (
					<div key={image.key} data-attachment-tile="" className="attachment-tile">
						<ImageContextMenu src={image.src} path={image.path} sessionId={sessionId}>
							<span
								role="button"
								tabIndex={0}
								aria-label={`Open ${image.label}`}
								onClick={open}
								onKeyDown={(event) =>
								{
									if (event.key === "Enter" || event.key === " ")
									{
										event.preventDefault();
										open(event);
									}
								}}
								className="attachment-media cursor-zoom-in"
							>
								<img src={image.src} alt="" loading="lazy" decoding="async" onError={hideFailedTile} />
							</span>
						</ImageContextMenu>
					</div>
				);
			})}
			{viewing !== null && (
				<Suspense fallback={null}>
					<ImageViewer
						images={images}
						index={viewing}
						sessionId={sessionId}
						origin={origin}
						onIndexChange={setViewing}
						onClose={() =>
						{
							setViewing(null);
						}}
					/>
				</Suspense>
			)}
		</div>
	);
}
