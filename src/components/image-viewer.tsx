import {Dialog} from "@base-ui/react/dialog";
import {ChevronLeft, ChevronRight, X} from "lucide-react";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type DragEvent,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
} from "react";
import {flushSync} from "react-dom";

import {
	clampPan,
	fitZoom,
	measureZoom,
	PAN_THRESHOLD,
	pinchZoom,
	WHEEL_LINE,
	WHEEL_RATE,
	zoomTransform,
	type ZoomState,
} from "../lib/image-zoom";
import {morph, setMorphName} from "../lib/image-viewer-morph";
import type {AttachedImage} from "./user-attachments";

/** Clicks this close to the Close button never select the neighbour slide underneath it. */
const CLOSE_HIT_SLOP = 16;

const SLIDE_IMG =
	"max-h-[70vh] max-w-full w-auto h-auto object-contain rounded-2xl motion-safe:transition-opacity motion-safe:duration-300";
const SLIDE = "h-full flex-shrink-0 flex items-center justify-center outline-none";
const FOCUS_RING = "group-focus-visible/zoomslide:ring-2 group-focus-visible/zoomslide:ring-white/70";

interface Pan {
	pointerId: number;
	startX: number;
	startY: number;
	tx: number;
	ty: number;
}

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

/** A click with no pointer behind it (assistive tech, element.click()). */
function isSyntheticClick(event: MouseEvent): boolean {
	const native = event.nativeEvent;
	return event.detail === 0 && !("pointerType" in native && native.pointerType !== "");
}

/** A wheel "page" moves by the stage's size, or a line when the stage has none. */
function pageUnit(size: number | undefined): number {
	return size === undefined || size === 0 ? WHEEL_LINE : size;
}

function slideImgClass(active: boolean, zoomed: boolean): string {
	const state = active
		? `opacity-100 ${FOCUS_RING} ${zoomed ? "cursor-zoom-out touch-none translate-z-px" : "cursor-zoom-in"}`
		: `opacity-40 hover:opacity-70 cursor-pointer ${FOCUS_RING}`;
	return `${SLIDE_IMG} ${state}`;
}

function slideClass(active: boolean, zoomed: boolean): string {
	if (!active) return SLIDE;
	return `${SLIDE} group/zoomslide${zoomed ? " z-10" : ""}`;
}

function focusedElement(): HTMLElement | null {
	return typeof document !== "undefined" && document.activeElement instanceof HTMLElement
		? document.activeElement
		: null;
}

function pagerButtonClass(disabled: boolean): string {
	return `p-2 rounded-lg ${disabled ? "text-white/30 cursor-default" : "text-white hover:bg-white/10"}`;
}

/**
 * Upstream's full-screen image viewer: every image is a 75vw slide in a
 * translateX track centred on the active one, neighbours peeking at 40%
 * opacity (click one to select it), Close at the top right, and a
 * non-wrapping Previous / "N of M" / Next pager. The active slide is a zoom
 * toggle (click, Enter/Space, ctrl+wheel pinch) and a zoomed image pans by
 * drag or wheel. Opening morphs from the `origin` thumbnail (hidden while
 * open) and closing morphs back, then refocuses what had focus. Decoded in
 * .llm/upstream-sync/dumps/image-viewer-bundle.txt.
 */
export function ImageViewer({
	images,
	index,
	origin = null,
	onIndexChange,
	onClose,
}: {
	images: readonly AttachedImage[];
	index: number;
	/** The thumbnail that opened the viewer: the open/close morph's other end. */
	origin?: HTMLElement | null;
	onIndexChange: (index: number) => void;
	onClose: () => void;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const activeImgRef = useRef<HTMLImageElement>(null);
	const activeSlideRef = useRef<HTMLDivElement>(null);
	const [returnFocus] = useState(focusedElement);
	const [openIndex] = useState(index);
	const openedRef = useRef(false);
	const focusedIndexRef = useRef(index);
	const panRef = useRef<Pan | null>(null);
	const draggedRef = useRef(false);
	const [popup, setPopup] = useState<HTMLDivElement | null>(null);
	const [zoom, setZoom] = useState<ZoomState | null>(null);
	const [zoomIndex, setZoomIndex] = useState(index);
	if (zoomIndex !== index) {
		setZoomIndex(index);
		setZoom(null);
	}
	const zoomRef = useRef(zoom);
	useEffect(() => {
		zoomRef.current = zoom;
	}, [zoom]);
	const zoomed = zoom !== null;
	useLayoutEffect(() => {
		if (popup === null || openedRef.current) return;
		openedRef.current = true;
		const img = origin === null ? null : activeImgRef.current;
		setMorphName(origin, true);
		// Transparent rather than hidden, so the dialog's initial focus still lands while the snapshot is taken.
		popup.style.opacity = "0";
		morph(
			() => {
				setMorphName(origin, false);
				if (origin !== null) origin.style.visibility = "hidden";
				popup.style.opacity = "";
				setMorphName(img, true);
			},
			() => {
				setMorphName(img, false);
			},
		);
	}, [popup, origin]);
	useEffect(
		() => () => {
			if (origin !== null) origin.style.visibility = "";
		},
		[origin],
	);
	useEffect(() => {
		if (focusedIndexRef.current === index) return;
		focusedIndexRef.current = index;
		const focused = document.activeElement;
		const inStage = focused !== null && stageRef.current?.contains(focused) === true;
		if (focused === null || focused === document.body || (inStage && focused.closest("a, button") === null))
			activeSlideRef.current?.focus({preventScroll: true});
	}, [index]);
	const requestClose = () => {
		const morphBack = origin !== null && index === openIndex;
		setMorphName(activeImgRef.current, morphBack);
		morph(
			() => {
				flushSync(onClose);
				if (origin !== null) {
					origin.style.visibility = "";
					setMorphName(origin, morphBack);
				}
				returnFocus?.focus({preventScroll: true});
			},
			() => {
				setMorphName(origin, false);
			},
		);
	};
	useEffect(() => {
		if (!zoomed) return undefined;
		const unzoom = () => {
			setZoom(null);
		};
		window.addEventListener("resize", unzoom);
		return () => {
			window.removeEventListener("resize", unzoom);
		};
	}, [zoomed]);
	useEffect(() => {
		if (popup === null) return undefined;
		const onWheel = (event: WheelEvent) => {
			const img = activeImgRef.current;
			if (panRef.current !== null || img === null) return;
			const stage = stageRef.current;
			const target = event.target instanceof Node ? event.target : null;
			const inside =
				target === null || stage?.contains(target) === true || toolbarRef.current?.contains(target) === true;
			const unit = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 1 : WHEEL_LINE;
			const page = event.deltaMode === WheelEvent.DOM_DELTA_PAGE;
			const unitX = page ? pageUnit(stage?.clientWidth) : unit;
			const unitY = page ? pageUnit(stage?.clientHeight) : unit;
			if (event.ctrlKey) {
				event.preventDefault();
				if (!inside) return;
				const geometry = zoomRef.current === null ? measureZoom(img, stage) : null;
				const point = {clientX: event.clientX, clientY: event.clientY};
				const factor = Math.exp(-event.deltaY * unit * WHEEL_RATE);
				setZoom((current) => pinchZoom(current, geometry, factor, point));
				return;
			}
			if (!inside || zoomRef.current === null) return;
			event.preventDefault();
			setZoom((current) => {
				if (current === null) return current;
				const tx = clampPan(current.tx - event.deltaX * unitX, current.maxTx);
				const ty = clampPan(current.ty - event.deltaY * unitY, current.maxTy);
				return tx === current.tx && ty === current.ty
					? current
					: {...current, tx, ty, idealTx: tx, idealTy: ty};
			});
		};
		popup.addEventListener("wheel", onWheel, {passive: false});
		return () => {
			popup.removeEventListener("wheel", onWheel);
		};
	}, [popup]);
	const toggleZoom = (point: {clientX: number; clientY: number} | null) => {
		const img = activeImgRef.current;
		if (img === null) return;
		setZoom(zoom === null ? fitZoom(img, stageRef.current, point) : null);
	};
	const onImgClick = (event: MouseEvent<HTMLImageElement>) => {
		event.stopPropagation();
		if (panRef.current !== null) return;
		toggleZoom(event);
	};
	const onSlideKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		if (!(event.target instanceof Element)) return;
		if (event.target.closest('a, button, [role="button"]') !== event.currentTarget) return;
		event.preventDefault();
		toggleZoom(null);
	};
	const onPanStart = (event: PointerEvent<HTMLImageElement>) => {
		if (zoom === null || event.button !== 0 || panRef.current !== null) return;
		draggedRef.current = false;
		panRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			tx: zoom.tx,
			ty: zoom.ty,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const onPanMove = (event: PointerEvent<HTMLImageElement>) => {
		const pan = panRef.current;
		if (pan === null || zoom === null || pan.pointerId !== event.pointerId) return;
		const dx = event.clientX - pan.startX;
		const dy = event.clientY - pan.startY;
		if (!draggedRef.current && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
		draggedRef.current = true;
		pan.tx = clampPan(zoom.tx + dx, zoom.maxTx);
		pan.ty = clampPan(zoom.ty + dy, zoom.maxTy);
		event.currentTarget.style.transform = zoomTransform({...zoom, tx: pan.tx, ty: pan.ty});
	};
	const onPanEnd = (event: PointerEvent<HTMLImageElement>) => {
		const pan = panRef.current;
		if (pan === null || pan.pointerId !== event.pointerId) return;
		panRef.current = null;
		if (!draggedRef.current) return;
		setZoom((current) => current && {...current, tx: pan.tx, ty: pan.ty, idealTx: pan.tx, idealTy: pan.ty});
		setTimeout(() => {
			draggedRef.current = false;
		}, 0);
	};
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
				if (!open) requestClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Popup
					ref={setPopup}
					finalFocus={false}
					onKeyDown={onKeyDown}
					onClickCapture={(event) => {
						if (draggedRef.current) event.stopPropagation();
					}}
					onClick={() => {
						if (zoomed) setZoom(null);
						else requestClose();
					}}
					className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black/80 outline-none"
				>
					<Dialog.Title className="sr-only">Image preview</Dialog.Title>
					<div
						ref={toolbarRef}
						className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-end gap-1.5 p-4"
						style={{background: TOOLBAR_GRADIENT}}
					>
						<button
							ref={closeRef}
							type="button"
							aria-label="Close"
							onClick={(event) => {
								event.stopPropagation();
								requestClose();
							}}
							className="pointer-events-auto flex size-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
						>
							<X aria-hidden="true" className="size-4" />
						</button>
					</div>
					<div ref={stageRef} data-viewer-stage="" className="relative flex-1 overflow-clip">
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
								const slideZoom = active ? zoom : null;
								return (
									// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a neighbour is a pointer shortcut (the arrow, Home and End keys and the pager are its keyboard controls); the active slide is a role=button with Enter/Space
									<div
										key={image.key}
										ref={active ? activeSlideRef : undefined}
										data-viewer-slide=""
										aria-hidden={!active}
										role={active ? "button" : undefined}
										aria-pressed={active ? slideZoom !== null : undefined}
										aria-label={active ? `Zoom image: ${image.label}` : undefined}
										tabIndex={active ? 0 : undefined}
										onKeyDown={active ? onSlideKeyDown : undefined}
										onClick={(event) => {
											if (!active) {
												if (zoomed || nearClose(event)) return;
												event.stopPropagation();
												onIndexChange(slideIndex);
												return;
											}
											if (event.target !== event.currentTarget || !isSyntheticClick(event))
												return;
											event.stopPropagation();
											if (panRef.current === null) toggleZoom(null);
										}}
										className={slideClass(active, slideZoom !== null)}
										style={{width: "75vw"}}
									>
										{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the slide around it is the keyboard zoom button */}
										<img
											ref={active ? activeImgRef : undefined}
											src={image.src}
											alt={image.label}
											decoding={active ? "sync" : "async"}
											referrerPolicy="no-referrer"
											onDragStart={preventDrag}
											onClick={active ? onImgClick : undefined}
											onPointerDown={slideZoom === null ? undefined : onPanStart}
											onPointerMove={slideZoom === null ? undefined : onPanMove}
											onPointerUp={onPanEnd}
											onPointerCancel={onPanEnd}
											style={
												slideZoom === null ? undefined : {transform: zoomTransform(slideZoom)}
											}
											className={slideImgClass(active, slideZoom !== null)}
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
