import
{
	type ReactNode,
	type Ref,
	type TransitionEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {flushSync} from "react-dom";
import {svgWithheld} from "../lib/mermaid-svg-audit";
import {useReducedMotion} from "../lib/reduced-motion";
import {useResolvedTheme} from "./theme-context";
import {MermaidDiagram, type MermaidStatus} from "./mermaid-diagram";
import {Icon} from "./ui/icon";
import {Tooltip} from "./ui/tooltip";

/*
 * Upstream's mermaid fence (c9e4d0c57 EpitaxyMermaidFence `we`, dumps/mermaid-fence-secret-fallback-c9e4d0c57.js.txt):
 * a code layer and a diagram layer stacked in one box. The diagram draws hidden under a placeholder and fades in on
 * success; View source fades back to the code block. A drawing that fails upstream's post-draw audit (secrets, even
 * split across labels, or glyph-bending styles) is withheld: the code block shows at once, with no note and no fade.
 * Left out here, as separate features: the lightbox (Expand and the row toolbar), the document figure width, and
 * in-page find.
 */

/** Upstream's note above a failed diagram (`GVQKxz`), shown on every render error. */
const MERMAID_RENDER_FAILED_NOTE = "This diagram couldn\u2019t be drawn. Showing its source.";

/**
 * Upstream's toolbar button: cds `Button` ghost, iconOnly, size base, the same component as the code card's Copy,
 * so it takes the Copy button's look (24px, 6px radius, t6 ink lifting to primary on the ghost hover).
 */
const TOOLBAR_BUTTON_CLASS =
	"inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 border-0 bg-transparent p-0 text-t6 hover:bg-[hsl(0_0%_4.3137%_/_0.06)] hover:text-primary dark:hover:bg-[hsl(0_0%_100%_/_0.08)] [&_svg]:size-4";

/** Upstream `ve`. */
const MOTION = "duration-base ease-out motion-reduce:transition-none";
/** Upstream `ye`: the fallback end of a fade whose transitionend never fires. */
const FADE_FALLBACK_MS = 400;

type LayerName = "code" | "diagram";
type LayerState = "shown" | "leaving" | "preparing";

/** Upstream `be`: one layer of the stack, hidden and inert unless shown. */
function FenceLayer({
	ref,
	layer,
	state,
	swapping,
	instant = false,
	onFadedOut,
	children,
}: {
	ref: Ref<HTMLDivElement>;
	layer: LayerName;
	state: LayerState;
	swapping: boolean;
	instant?: boolean;
	onFadedOut: () => void;
	children: ReactNode;
})
{
	const shown = state === "shown";
	const transition = instant ? "transition-none" : "transition-[opacity,visibility]";
	const placement = shown
		? `relative flow-root${swapping ? " starting:opacity-0" : ""}`
		: "pointer-events-none invisible absolute inset-x-0 top-0 opacity-0";
	const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) =>
	{
		if (state === "leaving" && event.target === event.currentTarget && event.propertyName === "opacity")
			onFadedOut();
	};
	return (
		<div
			ref={ref}
			data-testid="epitaxy-mermaid-fence-layer"
			data-layer={layer}
			data-state={state}
			aria-hidden={shown ? undefined : true}
			inert={!shown}
			className={`${transition} ${MOTION} ${placement}`}
			onTransitionEnd={handleTransitionEnd}
		>
			{children}
		</div>
	);
}

/** The renderer's status, or "withheld" when its drawing failed the audit. */
type FenceStatusName = MermaidStatus | "withheld";

interface FenceStatus
{
	code: string;
	status: FenceStatusName;
	/** The first status reported for this code; "success" means the drawing came from the cache. */
	first: FenceStatusName | null;
}

/** How {@link useFenceStatus}'s `askAgain` applies its update: at once, or through `flushSync`. */
type ApplyUpdate = (update: () => void) => void;

/**
 * Upstream `_e`: the diagram's status for the current code. A success whose drawing fails `passes` becomes
 * "withheld"; `askAgain` re-runs the audit on a shown drawing and withholds it if it now fails.
 */
function useFenceStatus(code: string, passes: () => boolean)
{
	const [state, setState] = useState<FenceStatus>(
		{
			code,
			status: "loading",
			first: null,
		},
	);
	if (state.code !== code)
		setState(
			{
				code,
				status: "loading",
				first: null,
			},
		);
	const onStatusChange = useCallback(
		(reported: MermaidStatus) =>
		{
			const status: FenceStatusName = reported === "success" && !passes() ? "withheld" : reported;
			setState((previous) =>
			{
				const first = previous.code === code && previous.first !== null ? previous.first : status;
				return previous.code === code && previous.status === status && previous.first === first
					? previous
					:
						{
							code,
							status,
							first,
						};
			});
		},
		[code, passes],
	);
	const askAgain = useCallback(
		(apply?: ApplyUpdate) =>
		{
			if (passes()) return;
			const update = () =>
			{
				setState((previous) =>
					previous.code === code && previous.status === "success"
						?
							{
								...previous,
								status: "withheld",
							}
						: previous,
				);
			};
			if (apply) apply(update);
			else update();
		},
		[code, passes],
	);
	return {
		status: state.code === code ? state.status : "loading",
		alreadyDrawn: state.code === code && state.first === "success",
		onStatusChange,
		askAgain,
	};
}

/** Upstream `G`: the mutations that can change what a drawing reads as. */
const DRAWING_MUTATIONS: MutationObserverInit =
{
	subtree: true,
	childList: true,
	characterData: true,
	attributeFilter: [
		"style",
		"direction",
		"unicode-bidi",
		"writing-mode",
		"font-variant",
		"word-spacing",
		"letter-spacing",
	],
};

/** Upstream `K`: `visit` on `root` and on every shadow root beneath it. */
function eachRoot(root: ParentNode, visit: (root: ParentNode) => void): void
{
	visit(root);
	for (const element of root.querySelectorAll("*")) if (element.shadowRoot) eachRoot(element.shadowRoot, visit);
}

/** Upstream `q`: the first `<svg>` under `root`, shadow roots included. */
function findDrawing(root: ParentNode | null): SVGSVGElement | null
{
	let drawing: SVGSVGElement | null = null;
	if (root) eachRoot(root, (each) => (drawing ??= each.querySelector("svg")));
	return drawing;
}

interface DrawingWatcher
{
	/** Observes the layer and any shadow root not yet observed; true when it found a new one. */
	arm: () => boolean;
	stop: () => void;
}

/** Upstream `xe`: watches the diagram layer and its shadow roots, calling `changed` on every mutation. */
function watchDrawing(layer: () => HTMLElement | null, changed: () => void): DrawingWatcher
{
	let observer: MutationObserver | null = null;
	const observed = new Set<ParentNode>();
	const arm = (): boolean =>
	{
		const root = layer();
		if (!root) return false;
		const active =
			observer ??
			new MutationObserver(() =>
			{
				arm();
				changed();
			});
		observer = active;
		let found = false;
		eachRoot(root, (each) =>
		{
			found ||= !observed.has(each);
			observed.add(each);
			active.observe(each, DRAWING_MUTATIONS);
		});
		return found;
	};
	return {
		arm,
		stop: () =>
		{
			observer?.disconnect();
			observed.clear();
		},
	};
}

/** Upstream `Ee`. */
function ignore(): void
{
}

interface Swap
{
	showing: LayerName;
	code: string;
	leaving: LayerName | null;
	instant: boolean;
	standIn: "placeholder" | "source";
}

/** Upstream `Te`. */
function endSwap(swap: Swap): Swap
{
	return swap.leaving === null
		? swap
		:
			{
				...swap,
				leaving: null,
			};
}

/** Upstream `ae`: force a reflow so the next height change transitions. */
function reflow(element: HTMLElement): void
{
	void element.offsetHeight;
}

export function MermaidFence({
	code,
	codeBlock,
	placeholder,
}: {
	code: string;
	/** The fence's ordinary code block, shown on View source, on failure, and once a code has drawn. */
	codeBlock: ReactNode;
	/** The stand-in before this code first draws. */
	placeholder: ReactNode;
})
{
	const mode = useResolvedTheme();
	const [viewSource, setViewSource] = useState(false);
	const layerRefs = useRef<Record<LayerName, HTMLDivElement | null>>(
		{
			code: null,
			diagram: null,
		},
	);
	const askAgainRef = useRef<(apply?: ApplyUpdate) => void>(ignore);
	const lastDrawing = useRef<SVGSVGElement | null>(null);
	const audit = useRef<
	{
		drawing: SVGSVGElement;
		passes: boolean;
	} | null>(null);
	const watcherRef = useRef<DrawingWatcher | null>(null);
	const watcher = useCallback(
		() =>
			(watcherRef.current ??= watchDrawing(
				() => layerRefs.current.diagram,
				() =>
				{
					audit.current = null;
					if (findDrawing(layerRefs.current.diagram)) askAgainRef.current(flushSync);
				},
			)),
		[],
	);
	// Upstream's audit, cached per drawing until the drawing or its shadow roots change.
	const passes = useCallback(() =>
	{
		if (watcher().arm()) audit.current = null;
		const drawing = findDrawing(layerRefs.current.diagram);
		lastDrawing.current = drawing;
		if (drawing !== null && drawing === audit.current?.drawing) return audit.current.passes;
		const passed = !svgWithheld(layerRefs.current.diagram);
		audit.current =
			drawing === null
				? null
				:
					{
						drawing,
						passes: passed,
					};
		return passed;
	}, [watcher]);
	const {status, alreadyDrawn, onStatusChange, askAgain} = useFenceStatus(code, passes);
	useEffect(() =>
	{
		askAgainRef.current = askAgain;
	}, [askAgain]);
	useEffect(() => () => watcherRef.current?.stop(), []);
	const withheld = status === "withheld";
	const failed = status === "error" || withheld;
	const success = status === "success";
	const label = viewSource ? "Preview" : "View source";

	const [drawnCode, setDrawnCode] = useState<string | null>(null);
	if (success && drawnCode !== code) setDrawnCode(code);
	const toolbarShown = !failed && (viewSource || success || drawnCode === code);
	const showing: LayerName = success && !viewSource ? "diagram" : "code";
	const awaitingFirstDraw = !viewSource && !failed && drawnCode !== code;
	const standIn = awaitingFirstDraw ? "placeholder" : "source";
	const reducedMotion = useReducedMotion();

	const [swap, setSwap] = useState<Swap>(() => (
	{
		showing,
		code,
		leaving: null,
		instant: false,
		standIn,
	}));
	if (swap.showing !== showing || swap.code !== code)
	{
		// A cached drawing replacing the placeholder swaps at once; anything else fades.
		const instant = alreadyDrawn && showing === "diagram" && swap.standIn === "placeholder";
		setSwap(
			{
				showing,
				code,
				leaving:
					!reducedMotion && swap.code === code && swap.showing !== showing && !withheld && !instant
						? swap.showing
						: null,
				instant,
				standIn: showing === "code" ? standIn : swap.standIn,
			},
		);
	}
	else if (showing === "code" && swap.standIn !== standIn)
	{
		setSwap(
			{
				...swap,
				standIn,
			},
		);
	}
	const {leaving} = swap;
	const shownStandIn = showing === "code" ? standIn : swap.standIn;

	const fadedOut = useCallback(() =>
	{
		setSwap(endSwap);
	}, []);
	useEffect(() =>
	{
		if (leaving === null) return undefined;
		const timer = setTimeout(fadedOut, FADE_FALLBACK_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [leaving, showing, fadedOut]);

	const showNote = status === "error";
	const rootRef = useRef<HTMLDivElement>(null);
	const stackRef = useRef<HTMLDivElement>(null);
	const lastStackTop = useRef(0);
	const restHeight = useRef(0);
	// Upstream's height tween: hold the old height, reflow, then move to the new one while the leaving layer is pinned.
	useLayoutEffect(() =>
	{
		const root = rootRef.current;
		const stack = stackRef.current;
		if (!root || !stack) return;
		const shownLayer = layerRefs.current[showing];
		const leavingLayer = leaving === null ? null : layerRefs.current[leaving];
		const stackTop = stack.offsetTop;
		const shift = lastStackTop.current - stackTop;
		let tween:
		{
			from: number;
			to: number;
		} | null = null;
		if (shownLayer && leavingLayer)
		{
			const shownHeight = shownLayer.offsetHeight;
			if (root.style.height === "")
			{
				const height = root.offsetHeight;
				restHeight.current = height - stackTop - shownHeight;
				tween =
				{
					from: height + shift + leavingLayer.offsetHeight - shownHeight,
					to: height,
				};
			}
			else
			{
				tween =
				{
					from: root.getBoundingClientRect().height,
					to: restHeight.current + stackTop + shownHeight,
				};
			}
		}
		lastStackTop.current = stackTop;
		for (const layer of Object.values(layerRefs.current))
		{
			if (layer !== leavingLayer) layer?.style.removeProperty("top");
		}
		if (!leavingLayer || !tween)
		{
			root.style.removeProperty("height");
			return;
		}
		leavingLayer.style.setProperty("top", `${shift}px`);
		root.style.setProperty("height", `${tween.from}px`);
		reflow(root);
		root.style.setProperty("height", `${tween.to}px`);
	}, [showing, leaving, showNote, toolbarShown]);

	const setCodeLayer = useCallback((element: HTMLDivElement | null) =>
	{
		layerRefs.current.code = element;
	}, []);
	const setDiagramLayer = useCallback(
		(element: HTMLDivElement | null) =>
		{
			layerRefs.current.diagram = element;
			audit.current = null;
			watcher().stop();
			watcher().arm();
			const drawing = findDrawing(element);
			if (drawing && drawing !== lastDrawing.current) askAgainRef.current();
		},
		[watcher],
	);
	const layerState = (layer: LayerName): LayerState =>
		showing === layer ? "shown" : leaving === layer ? "leaving" : "preparing";
	const codeMounted = showing === "code" || leaving === "code";
	const diagramMounted = !(viewSource || failed) || (leaving === "diagram" && !withheld);
	// Upstream `Se`: a drawing already in the layer while the status still reads loading counts as drawn.
	useLayoutEffect(() =>
	{
		if (status === "loading" && findDrawing(layerRefs.current.diagram)) onStatusChange("success");
	}, [status, onStatusChange, diagramMounted]);

	return (
		<div
			ref={rootRef}
			data-testid="epitaxy-mermaid-fence"
			aria-busy={(showing === "code" && awaitingFirstDraw) || undefined}
			className={`relative flex min-w-0 flex-col gap-xs transition-[height] ${MOTION}${leaving === null ? "" : " overflow-y-clip"}`}
		>
			{showNote && (
				<p className="text-footnote text-muted-as-secondary" role="note">
					{MERMAID_RENDER_FAILED_NOTE}
				</p>
			)}
			<div
				ref={stackRef}
				className={
					showing === "code" && leaving === null && diagramMounted ? "relative overflow-hidden" : "relative"
				}
			>
				{codeMounted && (
					<FenceLayer
						ref={setCodeLayer}
						layer="code"
						state={layerState("code")}
						swapping={leaving !== null}
						onFadedOut={fadedOut}
					>
						{shownStandIn === "placeholder" ? placeholder : codeBlock}
					</FenceLayer>
				)}
				{diagramMounted && (
					<FenceLayer
						ref={setDiagramLayer}
						layer="diagram"
						state={layerState("diagram")}
						swapping={leaving !== null}
						instant={swap.instant}
						onFadedOut={fadedOut}
					>
						<MermaidDiagram key={code} code={code} mode={mode} onStatusChange={onStatusChange} />
					</FenceLayer>
				)}
			</div>
			{toolbarShown && (
				<div data-placement="corner" className="absolute right-1.75 top-1.25 flex gap-0.5">
					<Tooltip content={label}>
						<button
							type="button"
							data-cds="Button"
							data-cds-icon-only=""
							data-cds-ghost=""
							data-testid="epitaxy-mermaid-fence-view"
							aria-label={label}
							className={TOOLBAR_BUTTON_CLASS}
							onClick={() =>
							{
								setViewSource((value) => !value);
							}}
						>
							<Icon name={viewSource ? "Eye" : "Code"} />
						</button>
					</Tooltip>
				</div>
			)}
		</div>
	);
}
