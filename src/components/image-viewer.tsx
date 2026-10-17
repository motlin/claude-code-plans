import {Dialog} from "@base-ui/react/dialog";
import {ChevronLeft, ChevronRight, X} from "lucide-react";
import {useRef, type DragEvent, type KeyboardEvent, type MouseEvent} from "react";

import type {AttachedImage} from "./user-attachments";

/** Clicks this close to the Close button never select the neighbour slide underneath it. */
const CLOSE_HIT_SLOP = 16;

const SLIDE_IMG =
	"max-h-[70vh] max-w-full w-auto h-auto object-contain rounded-2xl motion-safe:transition-opacity motion-safe:duration-300";

const TOOLBAR_GRADIENT =
	"linear-gradient(180deg, color-mix(in srgb, black 80%, transparent) 0%, color-mix(in srgb, black 80%, transparent) 75%, color-mix(in srgb, black 0%, transparent) 100%)";
const BOTTOM_GRADIENT =
	"linear-gradient(180deg, color-mix(in srgb, black 0%, transparent) 0%, color-mix(in srgb, black 80%, transparent) 66.41%)";

function stopPropagation(event: MouseEvent) {
	event.stopPropagation();
}

function preventDrag(event: DragEvent) {
	event.preventDefault();
}

function pagerButtonClass(disabled: boolean): string {
	return `p-2 rounded-lg ${disabled ? "text-white/30 cursor-default" : "text-white hover:bg-white/10"}`;
}

/**
 * Upstream's full-screen image viewer: every image is a 75vw slide in a
 * translateX track centred on the active one, neighbours peeking at 40%
 * opacity (click one to select it), Close at the top right, and a
 * non-wrapping Previous / "N of M" / Next pager. Decoded in
 * .llm/upstream-sync/dumps/image-viewer-bundle.txt.
 */
export function ImageViewer({
	images,
	index,
	onIndexChange,
	onClose,
}: {
	images: readonly AttachedImage[];
	index: number;
	onIndexChange: (index: number) => void;
	onClose: () => void;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const isFirst = index === 0;
	const isLast = index === images.length - 1;
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented) return;
		const targets: Partial<Record<string, number>> = {
			ArrowLeft: index - 1,
			ArrowRight: index + 1,
			Home: 0,
			End: images.length - 1,
		};
		const target = targets[event.key];
		if (target === undefined) return;
		event.preventDefault();
		onIndexChange(Math.min(Math.max(target, 0), images.length - 1));
	};
	const nearClose = (event: MouseEvent) => {
		const rect = closeRef.current?.getBoundingClientRect();
		return (
			rect !== undefined &&
			event.clientX >= rect.left - CLOSE_HIT_SLOP &&
			event.clientX <= rect.right + CLOSE_HIT_SLOP &&
			event.clientY >= rect.top - CLOSE_HIT_SLOP &&
			event.clientY <= rect.bottom + CLOSE_HIT_SLOP
		);
	};
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Popup
					onKeyDown={onKeyDown}
					onClick={onClose}
					className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black/80 outline-none"
				>
					<Dialog.Title className="sr-only">Image preview</Dialog.Title>
					<div
						className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-end gap-1.5 p-4"
						style={{background: TOOLBAR_GRADIENT}}
					>
						<button
							ref={closeRef}
							type="button"
							aria-label="Close"
							onClick={(event) => {
								event.stopPropagation();
								onClose();
							}}
							className="pointer-events-auto flex size-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
						>
							<X aria-hidden="true" className="size-4" />
						</button>
					</div>
					<div className="relative flex-1 overflow-clip">
						<div
							data-viewer-track=""
							className="flex h-full items-center motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
							style={{
								gap: "32px",
								transform: `translateX(calc(12.5vw - ${index * 75}vw - ${index * 32}px))`,
							}}
						>
							{images.map((image, slideIndex) => {
								const active = slideIndex === index;
								return (
									// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer shortcut to a neighbour; the arrow, Home and End keys and the pager buttons are the keyboard controls
									<div
										key={image.key}
										data-viewer-slide=""
										aria-hidden={!active}
										onClick={(event) => {
											if (active || nearClose(event)) return;
											event.stopPropagation();
											onIndexChange(slideIndex);
										}}
										className="flex h-full flex-shrink-0 items-center justify-center outline-none"
										style={{width: "75vw"}}
									>
										{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- only keeps a click on the active image from reaching the backdrop's close */}
										<img
											src={image.src}
											alt={image.label}
											decoding={active ? "sync" : "async"}
											referrerPolicy="no-referrer"
											onDragStart={preventDrag}
											onClick={active ? stopPropagation : undefined}
											className={`${SLIDE_IMG} ${active ? "opacity-100" : "opacity-40 hover:opacity-70 cursor-pointer"}`}
										/>
									</div>
								);
							})}
						</div>
						<div
							className="pointer-events-none absolute inset-x-0 bottom-0"
							style={{height: "max(128px, 10vh)", background: BOTTOM_GRADIENT}}
						/>
						{images.length > 1 && (
							// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only keeps pager clicks from reaching the backdrop's close
							<div
								onClick={stopPropagation}
								className="absolute inset-x-0 bottom-6 z-10 flex h-14 items-center justify-center px-6"
							>
								<div className="absolute top-1/2 left-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1">
									<button
										type="button"
										aria-label="Previous image"
										aria-disabled={isFirst}
										onClick={() => {
											if (!isFirst) onIndexChange(index - 1);
										}}
										className={pagerButtonClass(isFirst)}
									>
										<ChevronLeft aria-hidden="true" className="size-5" />
									</button>
									<span
										aria-live="polite"
										aria-atomic="true"
										className="pointer-events-none px-2 text-sm text-white/80 tabular-nums select-none"
									>
										{index + 1} of {images.length}
									</span>
									<button
										type="button"
										aria-label="Next image"
										aria-disabled={isLast}
										onClick={() => {
											if (!isLast) onIndexChange(index + 1);
										}}
										className={pagerButtonClass(isLast)}
									>
										<ChevronRight aria-hidden="true" className="size-5" />
									</button>
								</div>
							</div>
						)}
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
