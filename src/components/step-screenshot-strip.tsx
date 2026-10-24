import {PreviewCard} from "@base-ui/react/preview-card";
import {lazy, type MouseEvent, type ReactNode, Suspense, useId, useState} from "react";

import type {ToolResultImage} from "../lib/session-utils";

const ImageViewer = lazy(async () => import("./image-viewer").then((module) => ({default: module.ImageViewer})));

function imageSrc(image: ToolResultImage): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

interface Viewing {
	index: number;
	origin: HTMLElement;
	/** The row holding the opener, whose toggle takes focus if the opener is gone on close. */
	row: Element | null;
}

/**
 * The lightbox over a set of screenshots (upstream `cu`): every image, opened
 * at the clicked one with the clicked button as the morph origin, each slide
 * captioned with its step label ("Screenshot" when it has none). If focus fell
 * to the body by the time it closes, the nearest row toggle takes it (`a8`).
 */
function useScreenshotViewer(
	images: readonly ToolResultImage[],
	captions: readonly (string | undefined)[],
): {viewerOpen: boolean; open: (index: number, origin: HTMLElement) => void; viewer: ReactNode} {
	const [viewing, setViewing] = useState<Viewing | null>(null);
	const open = (index: number, origin: HTMLElement) => {
		setViewing({index, origin, row: origin.closest("[data-turn-status]")});
	};
	const viewer =
		viewing === null ? null : (
			<Suspense fallback={null}>
				<ImageViewer
					images={images.map((image, index) => ({
						key: String(index),
						src: imageSrc(image),
						label: captions[index] ?? "Screenshot",
					}))}
					captions={captions}
					index={viewing.index}
					origin={viewing.origin}
					fallbackFocus={() =>
						viewing.row?.isConnected === true
							? viewing.row.querySelector<HTMLElement>("button[aria-expanded]")
							: null
					}
					onIndexChange={(index) => {
						setViewing({...viewing, index});
					}}
					onClose={() => {
						setViewing(null);
					}}
				/>
			</Suspense>
		);
	return {viewerOpen: viewing !== null, open, viewer};
}

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
	/** A viewer is showing; thumbnails then open no preview card. */
	viewerOpen?: boolean;
	/** Told the clicked shot's group-wide index as the strip opens its viewer there. */
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
	const viewer = useScreenshotViewer(shots, captions);
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
								viewerOpen={viewerOpen || viewer.viewerOpen}
								onOpen={(index, origin) => {
									viewer.open(index - from, origin);
									onOpen?.(index);
								}}
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
			{viewer.viewer}
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
	onOpen: (index: number, origin: HTMLElement) => void;
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
	const src = imageSrc(shot);
	const label = total === 1 ? "Screenshot" : `Screenshot ${groupIndex + 1} of ${total}`;
	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		onOpen(groupIndex, event.currentTarget);
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
	/** Each image's step label, captioning it in the viewer. */
	captions: readonly (string | undefined)[];
}

/**
 * A step's full-size screenshots (upstream cb6930dae `md`/`Vw`): one "View
 * screenshot" button per image, drawn at the end of an expanded step's body
 * and, for a lone tool row, as a card after the row.
 */
export function StepScreenshots({images, padTop = true, captions}: StepScreenshotsProps) {
	const viewer = useScreenshotViewer(images, captions);
	return (
		<div data-step-screenshots="" className={`flex flex-col items-start gap-1${padTop ? " pt-p8" : ""}`}>
			{images.map((image, index) => (
				<button
					key={index}
					type="button"
					aria-label="View screenshot"
					className="max-w-full cursor-zoom-in focus-visible:outline-hidden hide-focus-ring focus-visible:ring-focus rounded-sm"
					onClick={(event) => {
						viewer.open(index, event.currentTarget);
					}}
				>
					<img alt="" className="max-w-full max-h-[360px] w-auto rounded-r4 border" src={imageSrc(image)} />
				</button>
			))}
			{viewer.viewer}
		</div>
	);
}
