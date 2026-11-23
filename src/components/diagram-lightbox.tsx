import {Dialog} from "@base-ui/react/dialog";
import {type MouseEvent, type ReactNode, type RefObject, useLayoutEffect, useRef, useState} from "react";

import
{
	createDiagramLightboxStore,
	type DiagramFigure,
	DiagramLightboxContext,
	type DiagramLightboxStore,
	useDiagramLightbox,
} from "../lib/diagram-lightbox";
import {Icon, type IconName} from "./ui/icon";
import {DensityScope} from "./ui/density";
import {GHOST_ICON_BUTTON, useDialogBandBodyClass} from "./ui/dialog-band";
import {DIALOG_BODY_CLASS} from "./ui/dialog-classes";
import {DialogHeader} from "./ui/dialog-header";
import {useDialogPad} from "./ui/dialog-pad";
import {DialogPopup} from "./ui/dialog-popup";

/*
 * Upstream's document diagram lightbox (c3fde7009 `Zr` dialog + `qr` stage; dumps/mermaid-diagram-lightbox-expand-
 * bundle-2026-11-18.js.txt): a 3xl cds dialog holding a copy of the expanded drawing in a shadow root, with a zoom
 * group in its header and Ctrl/⌘+wheel zoom on the stage.
 */

/** Upstream `Kr`: the stage's shadow-root sheet, sizing the copy to the stage. */
const STAGE_SHEET =
	":host > svg { display: block; width: 100% !important; max-width: none !important; height: auto !important; }";

/** Upstream `Jr`, `Yr`, `Xr`: one zoom step, the lowest floor, and the ceiling. */
const ZOOM_STEP = 1.25;
const ZOOM_FLOOR = 0.25;
const ZOOM_CEILING = 8;

/** Upstream's ghost iconOnly cds Button at the control height, as the dialog band's close draws it. */
const ZOOM_BUTTON_CLASS = `${GHOST_ICON_BUTTON} aspect-square size-8 panels-fine:size-7 rounded-r6`;

interface Zoom
{
	scale: number;
	/** The floor fixed by the first zoom: min(0.25, the fit scale then). */
	min: number;
}

/** Upstream `qr`. */
function DiagramStage({
	hostRef,
	drawing,
	width,
	height,
	scale,
	onZoomBy,
}: {
	hostRef: RefObject<HTMLDivElement | null>;
	drawing: SVGSVGElement;
	width: number;
	height: number;
	scale: number | null;
	onZoomBy: (factor: number) => void;
})
{
	const regionRef = useRef<HTMLDivElement>(null);
	const zoomBy = useRef(onZoomBy);
	zoomBy.current = onZoomBy;
	useLayoutEffect(() =>
	{
		const host = hostRef.current;
		if (!host) return;
		const root =
			host.shadowRoot ??
			host.attachShadow(
				{
					mode: "open",
				},
			);
		const sheet = host.ownerDocument.createElement("style");
		sheet.textContent = STAGE_SHEET;
		root.replaceChildren(sheet, drawing.cloneNode(true));
	}, [hostRef, drawing]);
	useLayoutEffect(() =>
	{
		const region = regionRef.current;
		if (!region) return undefined;
		const onWheel = (event: WheelEvent) =>
		{
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			zoomBy.current(Math.exp(-event.deltaY / 240));
		};
		region.addEventListener(
			"wheel",
			onWheel,
			{
				passive: false,
			},
		);
		return () =>
		{
			region.removeEventListener("wheel", onWheel);
		};
	}, []);
	return (
		<div
			ref={regionRef}
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's scrollable region takes focus so the keyboard can scroll it
			tabIndex={0}
			role="region"
			aria-label="Diagram, scrolls when larger than the dialog"
			className="hide-focus-ring mx-auto min-h-0 shrink overflow-auto rounded focus-visible:shadow-focus focus-visible:outline-hidden"
			style={
			{
				width: `${width}px`,
				maxWidth: "100%",
				aspectRatio: `${width} / ${height}`,
			}}
		>
			<div
				ref={hostRef}
				data-testid="document-diagram-stage"
				className="relative mx-auto [contain:paint]"
				style={
					scale === null
						?
							{
								width: `${width}px`,
								maxWidth: "100%",
							}
						:
							{
								width: `${width * scale}px`,
							}
				}
			/>
		</div>
	);
}

function ZoomButton({label, icon, onClick}: {label: string; icon: IconName; onClick: () => void})
{
	return (
		<button
			type="button"
			data-cds="Button"
			data-cds-icon-only=""
			data-cds-ghost=""
			aria-label={label}
			className={ZOOM_BUTTON_CLASS}
			onClick={onClick}
		>
			<Icon name={icon} />
		</button>
	);
}

function stopPropagation(event: MouseEvent)
{
	event.stopPropagation();
}

function selectDiagram(state: {diagram: DiagramFigure | null})
{
	return state.diagram;
}

function selectOpen(state: {open: boolean})
{
	return state.open;
}

/** Upstream `Zr`: the store's figure in a dialog, mounted until its close finishes. */
export function DiagramLightbox({store}: {store: DiagramLightboxStore})
{
	const diagram = useDiagramLightbox(store, selectDiagram);
	const open = useDiagramLightbox(store, selectOpen);
	const hostRef = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState<Zoom | null>(null);
	const [zoomFor, setZoomFor] = useState(diagram);
	if (zoomFor !== diagram)
	{
		setZoomFor(diagram);
		setZoom(null);
	}
	const pad = useDialogPad();
	const bandBody = useDialogBandBodyClass();
	if (diagram === null) return null;
	const {width, height} = diagram;
	const zoomBy = (factor: number) =>
	{
		setZoom((previous) =>
		{
			// Upstream's `clientWidth || width`: an unlaid-out stage (0) fits at its natural width.
			const stageWidth = hostRef.current?.clientWidth ?? 0;
			const fit = Math.min(1, (stageWidth === 0 ? width : stageWidth) / width);
			const min = previous?.min ?? Math.min(ZOOM_FLOOR, fit);
			return {
				scale: Math.min(ZOOM_CEILING, Math.max(min, (previous?.scale ?? fit) * factor)),
				min,
			};
		});
	};
	const actions: ReactNode = (
		<div
			data-cds="ButtonGroup"
			role="group"
			aria-label="Diagram zoom"
			className="relative inline-flex w-fit shrink-0 items-stretch gap-xs"
		>
			<ZoomButton
				label="Zoom out"
				icon="ZoomOut"
				onClick={() =>
				{
					zoomBy(1 / ZOOM_STEP);
				}}
			/>
			<ZoomButton
				label="Reset zoom"
				icon="ArrowCounterClockwise"
				onClick={() =>
				{
					setZoom(null);
				}}
			/>
			<ZoomButton
				label="Zoom in"
				icon="ZoomIn"
				onClick={() =>
				{
					zoomBy(ZOOM_STEP);
				}}
			/>
		</div>
	);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) =>
			{
				store.getState().setOpen(next);
			}}
			onOpenChangeComplete={(next) =>
			{
				if (!next) store.getState().release();
			}}
		>
			<Dialog.Portal>
				<div className="pointer-events-auto relative z-[140]">
					<DensityScope density="comfortable">
						<Dialog.Backdrop className="fixed inset-0 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
						<DialogPopup
							onContextMenu={stopPropagation}
							className="fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body font-normal text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100 epitaxy-root w-max min-w-[min(720px,90vw)] max-w-[90vw] break-words"
						>
							<div className={`${DIALOG_BODY_CLASS} ${pad.p} ${bandBody}`}>
								<DialogHeader title={<span className="sr-only">Diagram</span>} actions={actions} />
								<DiagramStage
									hostRef={hostRef}
									drawing={diagram.drawing}
									width={width}
									height={height}
									scale={zoom?.scale ?? null}
									onZoomBy={zoomBy}
								/>
							</div>
						</DialogPopup>
					</DensityScope>
				</div>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/**
 * Upstream c3fde7009's document wrapper: a lightbox store for the prose inside, so its mermaid fences offer Expand,
 * and the dialog that shows what they expand.
 */
export function DocumentDiagrams({children}: {children: ReactNode})
{
	const [store] = useState(createDiagramLightboxStore);
	return (
		<DiagramLightboxContext value={store}>
			{children}
			<DiagramLightbox store={store} />
		</DiagramLightboxContext>
	);
}
