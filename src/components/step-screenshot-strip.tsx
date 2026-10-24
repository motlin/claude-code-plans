import {type MouseEvent, useId} from "react";

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
					const label = total === 1 ? "Screenshot" : `Screenshot ${groupIndex + 1} of ${total}`;
					const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
						event.stopPropagation();
						onOpen?.(groupIndex);
					};
					return (
						<div key={index} className={index === lastIndex ? "contents" : "contents max-sm:hidden"}>
							<button
								type="button"
								aria-label={label}
								aria-describedby={caption === undefined ? undefined : descriptionId}
								className={THUMB_CLASS}
								onClick={handleClick}
							>
								<img
									alt=""
									className="h-full w-auto max-w-full object-cover object-left-top"
									src={`data:${shot.mimeType};base64,${shot.data}`}
									{...(lazy ? {loading: "lazy", decoding: "async"} : {})}
								/>
							</button>
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
