import {Dialog} from "@base-ui/react/dialog";
import {X} from "lucide-react";
import {useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent} from "react";
import {flushSync} from "react-dom";

import {morph, setMorphName} from "../lib/image-viewer-morph";
import {PHONE_SHEET_QUERY, useMediaQuery} from "../lib/use-phone-sheet";
import {DensityScope} from "./ui/density";

const MORPH_NAME = "chat-image-preview";
const ACTIVE_CLASS = "vt-image-preview-active";
const CLOSING_CLASS = "vt-image-preview-closing";
const CROSSFADE_CLASS = "vt-image-preview-crossfade";
const DEFAULT_SOURCE_RADIUS = ".5rem";
const DEFAULT_TARGET_RADIUS = ".375rem";

const IMAGE_SHADOW =
	"0 4px 32px color-mix(in srgb, black 30%, transparent), 0 0 0 0.5px color-mix(in srgb, black 25%, transparent)";

// Upstream's cds ButtonGroup gap-xs is 8px; the local token set has no `xs` spacing.
const GROUP_CLASS = "inline-flex w-fit shrink-0 flex-col items-stretch gap-2";
const WIDE_GROUP_POSITION = "absolute start-full top-0 ms-1.5";
const NARROW_GROUP_POSITION = "absolute end-1.5 top-1.5";

const BUTTON_CLASS =
	"flex size-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";
const GHOST_BUTTON_CLASS = `${BUTTON_CLASS} hover:bg-fill-ghost-hover`;
const ON_CONTENT_BUTTON_CLASS = `${BUTTON_CLASS} bg-black/55 hover:bg-black/70`;

function focusedElement(): HTMLElement | null {
	return typeof document !== "undefined" &&
		document.activeElement instanceof HTMLElement &&
		document.activeElement !== document.body
		? document.activeElement
		: null;
}

function stopPropagation(event: MouseEvent) {
	event.stopPropagation();
}

function preventDrag(event: DragEvent) {
	event.preventDefault();
}

/** Seeds the morph's radius keyframes: the tile's corner radius into the preview's 6px. */
function setMorphRadii(origin: HTMLElement | null, target: HTMLElement | null) {
	const style = document.documentElement.style;
	const source = origin === null ? "" : getComputedStyle(origin).borderRadius;
	const targetRadius = target === null ? "" : getComputedStyle(target).borderRadius;
	style.setProperty("--vt-image-preview-source-inset", "0%");
	style.setProperty("--vt-image-preview-source-radius", source === "" ? DEFAULT_SOURCE_RADIUS : source);
	style.setProperty("--vt-image-preview-target-radius", targetRadius === "" ? DEFAULT_TARGET_RADIUS : targetRadius);
}

function markTransition(origin: HTMLElement | null, closing: boolean) {
	const classes = document.documentElement.classList;
	classes.add(ACTIVE_CLASS);
	if (closing) classes.add(CLOSING_CLASS);
	if (origin === null) classes.add(CROSSFADE_CLASS);
}

function clearTransition() {
	document.documentElement.classList.remove(ACTIVE_CLASS, CLOSING_CLASS, CROSSFADE_CLASS);
}

/**
 * Upstream's composer image preview (cb1b78cfa `ImagePreviewModal`): one image
 * on a 62.5% black full-screen popup, a vertical Close toolbar beside it (over
 * it below 40rem), closing on a click anywhere but the toolbar, or on Escape.
 * Opening morphs the `origin` tile into the image (`chat-image-preview`), which
 * stays hidden while open; closing morphs back and refocuses the opener. With
 * no origin it crossfades, and under reduced motion it does neither.
 */
export function ImagePreviewModal({
	src,
	alt,
	open,
	origin,
	onClose,
}: {
	src: string;
	alt: string;
	open: boolean;
	/** The tile image that opened the preview: the morph's other end. */
	origin: HTMLElement | null;
	onClose: () => void;
}) {
	const narrow = useMediaQuery(PHONE_SHEET_QUERY);
	const closeRef = useRef<HTMLButtonElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const generationRef = useRef(0);
	const pendingFocusRef = useRef<HTMLElement | null>(null);
	const [popup, setPopup] = useState<HTMLDivElement | null>(null);
	const [session, setSession] = useState<{returnFocus: HTMLElement | null} | null>(() =>
		open ? {returnFocus: focusedElement()} : null,
	);
	if (open && session === null) setSession({returnFocus: focusedElement()});

	useLayoutEffect(() => {
		if (popup === null) return;
		const generation = ++generationRef.current;
		const img = origin === null ? null : imgRef.current;
		setMorphRadii(origin, wrapperRef.current);
		markTransition(origin, false);
		setMorphName(origin, true, MORPH_NAME);
		// Transparent rather than hidden, so the dialog's initial focus still lands while the snapshot is taken.
		popup.style.opacity = "0";
		const finish = () => {
			setMorphName(img, false, MORPH_NAME);
			if (generationRef.current === generation) clearTransition();
		};
		const started = morph(() => {
			setMorphName(origin, false, MORPH_NAME);
			if (origin !== null) origin.style.visibility = "hidden";
			popup.style.opacity = "";
			setMorphName(img, true, MORPH_NAME);
		}, finish);
		if (!started) finish();
	}, [popup, origin]);

	useLayoutEffect(() => {
		if (open || session === null) return;
		const generation = ++generationRef.current;
		const morphBack = origin !== null;
		markTransition(origin, true);
		setMorphName(imgRef.current, morphBack, MORPH_NAME);
		let synchronous = true;
		const finish = () => {
			setMorphName(origin, false, MORPH_NAME);
			if (generationRef.current === generation) clearTransition();
		};
		const started = morph(() => {
			pendingFocusRef.current = session.returnFocus;
			if (synchronous) setSession(null);
			else
				flushSync(() => {
					setSession(null);
				});
			if (origin !== null) {
				origin.style.visibility = "";
				setMorphName(origin, morphBack, MORPH_NAME);
			}
		}, finish);
		synchronous = false;
		if (!started) finish();
	}, [open, session, origin]);

	useLayoutEffect(() => {
		if (session !== null) return;
		const target = pendingFocusRef.current;
		pendingFocusRef.current = null;
		if (target?.isConnected === true) target.focus({preventScroll: true});
	}, [session]);

	useEffect(
		() => () => {
			if (origin !== null) origin.style.visibility = "";
		},
		[origin],
	);

	if (session === null) return null;

	const requestClose = () => {
		if (open) onClose();
	};
	const closeFromImage = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		requestClose();
	};

	return (
		<Dialog.Root
			open
			onOpenChange={(next) => {
				if (!next) requestClose();
			}}
		>
			<Dialog.Portal>
				<div className="pointer-events-auto relative z-[140]">
					<DensityScope density="comfortable">
						<Dialog.Backdrop
							data-image-preview-backdrop=""
							className="fixed inset-0 bg-transparent backdrop-blur-none"
						/>
						<Dialog.Popup
							ref={setPopup}
							initialFocus={closeRef}
							finalFocus={false}
							onClick={requestClose}
							className="fixed inset-0 grid place-items-center p-4 sm:p-10 bg-black/62.5 outline-none"
						>
							<Dialog.Title className="sr-only">{alt}</Dialog.Title>
							<div className="max-w-[40rem] w-full">
								{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only keeps toolbar-gap clicks from reaching the popup's close; Escape and Close are the keyboard path */}
								<div className="relative w-fit mx-auto" onClick={stopPropagation}>
									<div data-mode="dark" className="dark contents text-primary">
										<div
											role="group"
											aria-label="Image preview actions"
											className={`${GROUP_CLASS} ${narrow ? NARROW_GROUP_POSITION : WIDE_GROUP_POSITION}`}
										>
											<Dialog.Close
												ref={closeRef}
												aria-label="Close image preview"
												data-testid="close-file-preview"
												className={narrow ? ON_CONTENT_BUTTON_CLASS : GHOST_BUTTON_CLASS}
											>
												<X aria-hidden="true" className="h-5 w-5" />
											</Dialog.Close>
										</div>
									</div>
									{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer shortcut for Close, which holds initial focus */}
									<div
										ref={wrapperRef}
										className="w-fit rounded-md overflow-hidden"
										style={{boxShadow: IMAGE_SHADOW}}
										onClick={closeFromImage}
									>
										{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only cancels native image dragging */}
										<img
											ref={imgRef}
											src={src}
											alt={alt}
											decoding="sync"
											onDragStart={preventDrag}
											className="block max-w-full max-h-[calc(100vh-4rem)] w-auto h-auto"
										/>
									</div>
								</div>
							</div>
						</Dialog.Popup>
					</DensityScope>
				</div>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
