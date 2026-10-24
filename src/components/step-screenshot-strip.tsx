import {PreviewCard} from "@base-ui/react/preview-card";
import {type MouseEvent, useId, useState} from "react";

import type {ToolResultImage} from "../lib/session-utils";

/** Upstream shows at most this many thumbnails on desktop (shared-13 `dN`). */
const VISIBLE_SHOTS = 3;

const THUMB_CLASS =
	"h-6 max-w-11 shrink-0 cursor-zoom-in overflow-hidden rounded-sm border-[0.5px] border-strong shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-fill-accent";

export interface StepScreenshotStripProps {
	/** The strip's images, in step order. */
	shots: readonly ToolResultImage[];
	/** Each shot's step label (its accessible description), aligned with `shots`. */
	captions: readonly (string | undefined)[];
	/** Group-wide index of the first shot, so a step strip keeps the group's numbering. */
	from?: number;
	/** Group-wide image count; defaults to `from + shots.length`. */
	total?: number;
	/** Lazy-load the images (step rows inside an expanded group). */
	lazy?: boolean;
	/** The viewer is showing; thumbnails then open no preview card. */
	viewerOpen?: boolean;
	/** Open the viewer at the clicked shot's group-wide index. */
	onOpen?: (index: number) => void;
}

/**
 * The 24px screenshot thumbnail strip at the end of a tool-group or step row
 * (upstream shared-13 `UL`/`Dz`, size "sm"): the last three shots behind a
 * `+N` counter, collapsing to the last shot plus `+{N-1}` at phone width.
 */
export function StepScreenshotStrip({
	shots,
	captions,
	from = 0,
	total = from + shots.length,
	lazy = false,
	viewerOpen = false,
	onOpen,
}: StepScreenshotStripProps) {
	const id = useId();
	const count = shots.length;
	const firstVisible = Math.max(0, count - VISIBLE_SHOTS);
	const lastIndex = count - 1;

	return (
		<div className="flex h-6 shrink-0 items-center gap-2 my-[calc((1lh_-_--spacing(6))_/_2)]">
			{firstVisible > 0 && (
				<span aria-hidden className="tabular-nums text-ink-muted max-sm:hidden">
					+{firstVisible}
				</span>
			)}
			{lastIndex > 0 && (
				<span aria-hidden className="tabular-nums text-ink-muted sm:hidden">
					+{lastIndex}
				</span>
			)}
			<div className="flex h-6 items-center gap-1">
				{shots.slice(firstVisible).map((shot, offset) => {
					const index = firstVisible + offset;
					const groupIndex = from + index;
					const caption = captions[index];
					const descriptionId = `${id}-${index}`;
					return (
						<div key={index} className={index === lastIndex ? "contents" : "contents max-sm:hidden"}>
							<Thumbnail
								shot={shot}
								caption={caption}
								descriptionId={descriptionId}
								groupIndex={groupIndex}
								total={total}
								lazy={lazy}
								viewerOpen={viewerOpen}
								onOpen={onOpen}
							/>
							{caption !== undefined && (
								<span id={descriptionId} className="sr-only select-none" data-find-omitted="">
									{caption}
								</span>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

/** Upstream's PreviewCard `delay: 150`. */
const PREVIEW_DELAY_MS = 150;

const PREVIEW_POPUP_CLASS =
	"flex flex-col gap-1 overflow-hidden rounded-r7 bg-surface-3 p-0 shadow-[var(--menu-shadow)] outline-none w-[min(20rem,100vw-2rem)]";

interface ThumbnailProps {
	shot: ToolResultImage;
	caption: string | undefined;
	descriptionId: string;
	groupIndex: number;
	total: number;
	lazy: boolean;
	viewerOpen: boolean;
	onOpen: ((index: number) => void) | undefined;
}

/**
 * One strip thumbnail. Hover or keyboard focus opens upstream's preview card
 * above it (side top, align end): the image over a caption and "N of M"
 * footer. The card ignores the pointer (upstream `hoverable: false`), so it
 * closes as the pointer leaves the thumbnail, and stays shut while the viewer
 * is open.
 */
function Thumbnail({shot, caption, descriptionId, groupIndex, total, lazy, viewerOpen, onOpen}: ThumbnailProps) {
	const [previewOpen, setPreviewOpen] = useState(false);
	const src = `data:${shot.mimeType};base64,${shot.data}`;
	const label = total === 1 ? "Screenshot" : `Screenshot ${groupIndex + 1} of ${total}`;
	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		onOpen?.(groupIndex);
	};
	return (
		<PreviewCard.Root open={previewOpen && !viewerOpen} onOpenChange={setPreviewOpen}>
			<PreviewCard.Trigger
				delay={PREVIEW_DELAY_MS}
				closeDelay={0}
				render={
					<button
						type="button"
						aria-label={label}
						aria-describedby={caption === undefined ? undefined : descriptionId}
						className={THUMB_CLASS}
						onClick={handleClick}
					/>
				}
			>
				<img
					alt=""
					className="h-full w-auto max-w-full object-cover object-left-top"
					src={src}
					{...(lazy ? {loading: "lazy", decoding: "async"} : {})}
				/>
			</PreviewCard.Trigger>
			<PreviewCard.Portal>
				<PreviewCard.Positioner side="top" align="end" className="pointer-events-none z-[100]">
					<PreviewCard.Popup data-screenshot-preview="" className={PREVIEW_POPUP_CLASS}>
						<div className="overflow-hidden rounded-[inherit]">
							<img
								alt=""
								className="max-h-60 w-full bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)] object-contain"
								src={src}
							/>
						</div>
						<div className="flex items-baseline gap-2 px-3 py-2 text-footnote">
							<bdi className="min-w-0 flex-1 truncate text-primary">{caption ?? "Screenshot"}</bdi>
							{total > 1 && (
								<span className="shrink-0 tabular-nums text-ink-muted">
									{groupIndex + 1} of {total}
								</span>
							)}
						</div>
					</PreviewCard.Popup>
				</PreviewCard.Positioner>
			</PreviewCard.Portal>
		</PreviewCard.Root>
	);
}

export interface StepScreenshotsProps {
	images: readonly ToolResultImage[];
	/** Open 8px above the images, as an expanded step's body does; a lone row's card sits flush. */
	padTop?: boolean;
	/** Open the viewer at the clicked image's index. */
	onOpen?: (index: number) => void;
}

/**
 * A step's full-size screenshots (upstream cb6930dae `md`/`Vw`): one "View
 * screenshot" button per image, drawn at the end of an expanded step's body
 * and, for a lone tool row, as a card after the row.
 */
export function StepScreenshots({images, padTop = true, onOpen}: StepScreenshotsProps) {
	return (
		<div data-step-screenshots="" className={`flex flex-col items-start gap-1${padTop ? " pt-p8" : ""}`}>
			{images.map((image, index) => (
				<button
					key={index}
					type="button"
					aria-label="View screenshot"
					className="max-w-full cursor-zoom-in focus-visible:outline-hidden hide-focus-ring focus-visible:ring-focus rounded-sm"
					onClick={() => onOpen?.(index)}
				>
					<img
						alt=""
						className="max-w-full max-h-[360px] w-auto rounded-r4 border"
						src={`data:${image.mimeType};base64,${image.data}`}
					/>
				</button>
			))}
		</div>
	);
}
