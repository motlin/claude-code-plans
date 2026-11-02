import {CircleAlert, Info, TriangleAlert} from "lucide-react";
import
{
	type CSSProperties,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {useFizzyLake} from "../lib/fizzy-lake";
import {ToastContext, type ToastKind, type ToastOptions} from "./toast-context";

interface ToastEntry extends ToastOptions
{
	id: number;
	/** How many identical toasts this one stands for; upstream appends " (×N)" past one. */
	count: number;
	/** Bumped on each repeat so the open toast restarts its timer. */
	repeat: number;
}

const NEUTRAL_DURATION_MS = 4000;
/** Upstream keeps non-info toasts (errors, warnings) up for 10s. */
const ALERT_DURATION_MS = 10_000;
/** A re-shown toast stays up at least this long. */
const REPEAT_MIN_MS = 6000;
/** Upstream's deck: each older toast sits 14px higher and 4% smaller behind the front one. */
const DECK_OFFSET_PX = 14;
const DECK_SCALE_STEP = 0.04;

/** Upstream's cds Toast variant: the bridge maps `toastType` ("info" → "neutral"). */
type ToastVariant = "neutral" | "warning" | "danger";

/** Upstream `GY`: addError, addApiError and addWarning all store `toastType: "warning"`. */
const VARIANT_OF =
{
	success: "neutral",
	warning: "warning",
	error: "warning",
	danger: "danger",
} as const satisfies Record<ToastKind, ToastVariant>;

/** Upstream's `stacks:shadow-panel-md stacks:bg-none stacks:text-primary`: fizzy color drops the tint. */
const STACKS_CARD = "bg-surface-popover text-primary shadow-panel-md";

/** Upstream `Zq` + `V9` without fizzy color: the card is tinted, ringed and inked by its variant. */
const PRE_FIZZY_CARD =
{
	neutral: STACKS_CARD,
	warning:
		"bg-[color-mix(in_srgb,var(--color-warning-100)_10%,var(--color-surface-popover))] text-warning-000 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-warning-100)_35%,transparent),var(--shadow-panel-md)]",
	danger: "bg-[color-mix(in_srgb,var(--color-danger-100)_10%,var(--color-surface-popover))] text-danger-000 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-danger-100)_35%,transparent),var(--shadow-panel-md)]",
} as const satisfies Record<ToastVariant, string>;

/** Upstream `TQ`: the icon wrap's ink; without fizzy color warning/danger inherit the card ink. */
function iconInk(variant: ToastVariant, fizzyColor: boolean): string
{
	if (variant === "neutral") return "text-secondary";
	if (!fizzyColor) return "";
	return variant === "warning" ? "text-fill-warning" : "text-fill-danger";
}

/** Upstream `yx`'s content identity; a keyed toast has a key identity and never folds. */
function sameToast(a: ToastOptions, b: ToastOptions): boolean
{
	if (a.uniqueKey !== undefined || b.uniqueKey !== undefined) return false;
	return VARIANT_OF[a.kind] === VARIANT_OF[b.kind] && a.message === b.message && a.description === b.description;
}

function durationFor(entry: ToastEntry): number | null
{
	if (entry.durationMs !== undefined) return entry.durationMs;
	if (entry.action !== undefined) return null;
	return VARIANT_OF[entry.kind] === "neutral" ? NEUTRAL_DURATION_MS : ALERT_DURATION_MS;
}

/** Base UI's `visuallyHidden` style, which its Toast viewport uses for the danger announcer. */
const VISUALLY_HIDDEN: CSSProperties =
{
	clipPath: "inset(50%)",
	overflow: "hidden",
	whiteSpace: "nowrap",
	border: 0,
	padding: 0,
	width: 1,
	height: 1,
	margin: -1,
	position: "fixed",
	top: 0,
	left: 0,
};

/** Upstream `W_`: the fixed cds Toast viewport, anchored bottom-left under RTL. */
const VIEWPORT_CLASS =
	"pointer-events-none fixed right-4 bottom-4 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col-reverse gap-md [&:where(:root[dir=rtl]_:dir(rtl))]:right-auto [&:where(:root[dir=rtl]_:dir(rtl))]:left-4";

/** Base UI `Toast.Viewport` as upstream styles it. */
const REGION_CLASS = "pointer-events-auto relative outline-none focus-visible:outline-hidden";

/** Tracks the front toast's height, as Base UI sizes its viewport to the frontmost toast. */
function useFrontHeight(region: RefObject<HTMLElement | null>, frontId: number | undefined): number
{
	const [height, setHeight] = useState(0);
	useLayoutEffect(() =>
	{
		const front = region.current?.querySelector<HTMLElement>("[data-toast]") ?? null;
		if (frontId === undefined || front === null)
		{
			setHeight(0);
			return undefined;
		}
		setHeight(front.offsetHeight);
		if (typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(() =>
		{
			setHeight(front.offsetHeight);
		});
		observer.observe(front);
		return () =>
		{
			observer.disconnect();
		};
	}, [region, frontId]);
	return height;
}

/** Window blur pauses every toast timer and window focus resumes them, as Base UI's ToastProvider. */
function useWindowFocused(): boolean
{
	const [focused, setFocused] = useState(true);
	useEffect(() =>
	{
		const onBlur = () =>
		{
			setFocused(false);
		};
		const onFocus = () =>
		{
			setFocused(true);
		};
		window.addEventListener("blur", onBlur);
		window.addEventListener("focus", onFocus);
		return () =>
		{
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focus", onFocus);
		};
	}, []);
	return focused;
}

/**
 * Upstream's toasts: the cds Toast viewport (Base UI Toast) stacked bottom-right, newest first in
 * the DOM and in front, with older ones peeking 14px above it. Toasts auto-dismiss (paused while
 * the deck is hovered or focused, or the window is blurred) unless they carry an action such as
 * [Undo]. A repeat folds into the open toast as "(×2)"; a toast with the same uniqueKey replaces it
 * instead. Every toast announces through one polite Notifications region; a danger toast's
 * alertdialog stays aria-hidden and is announced by a visually hidden role=alert until the region
 * takes focus.
 */
export function ToastProvider({
	children,
}: Readonly<
{
	children: ReactNode;
}>)
{
	const [toasts, setToasts] = useState<ToastEntry[]>([]);
	const nextId = useRef(0);
	const fizzyColor = useFizzyLake("color");
	const region = useRef<HTMLDivElement>(null);
	const [hovered, setHovered] = useState(false);
	const [regionFocused, setRegionFocused] = useState(false);
	const windowFocused = useWindowFocused();
	/** Base UI `prevFocusElement`: where focus came from before it entered the deck. */
	const prevFocus = useRef<HTMLElement | null>(null);

	const dismiss = useCallback((id: number) =>
	{
		setToasts((current) => current.filter((t) => t.id !== id));
	}, []);

	/** Base UI `handleFocusManagement`: focus the next older toast, else the newer one, else the pre-deck element. */
	const close = useCallback(
		(id: number, root: HTMLElement) =>
		{
			const viewportRegion = root.parentElement;
			if (viewportRegion?.contains(document.activeElement) === true)
			{
				const roots = [...viewportRegion.children].filter((el) => el.hasAttribute("data-toast"));
				const index = roots.indexOf(root);
				const next = roots[index + 1] ?? roots[index - 1];
				if (next instanceof HTMLElement) next.focus();
				else prevFocus.current?.focus();
			}
			dismiss(id);
		},
		[dismiss],
	);

	const toast = useCallback((options: ToastOptions) =>
	{
		const {signal} = options;
		if (signal?.aborted === true) return;
		setToasts((current) =>
		{
			if (options.uniqueKey !== undefined)
			{
				// Upstream `ta`: close the same-key card (its action never runs) and add a new one at the front.
				nextId.current += 1;
				return [
					...current.filter((entry) => entry.uniqueKey !== options.uniqueKey),
					{
						...options,
						id: nextId.current,
						count: 1,
						repeat: 0,
					},
				];
			}
			const open = current.find((entry) => sameToast(entry, options));
			if (open !== undefined)
			{
				return current.map((entry) =>
					entry === open
						?
							{
								...entry,
								count: entry.count + 1,
								repeat: entry.repeat + 1,
							}
						: entry,
				);
			}
			nextId.current += 1;
			return [
				...current,
				{
					...options,
					id: nextId.current,
					count: 1,
					repeat: 0,
				},
			];
		});
		signal?.addEventListener(
			"abort",
			() =>
			{
				setToasts((current) => current.filter((t) => t.signal !== signal));
			},
			{
				once: true,
			},
		);
	}, []);

	const newestFirst = toasts.toReversed();
	const frontHeight = useFrontHeight(region, newestFirst[0]?.id);
	const expanded = hovered || regionFocused;
	const paused = expanded || !windowFocused;
	const dangers = newestFirst.filter((t) => VARIANT_OF[t.kind] === "danger");
	return (
		<ToastContext.Provider value={toast}>
			{children}
			<div
				data-cds="Toast"
				data-position="bottom-right"
				style={
				{
					zIndex: 100,
				}}
				className={VIEWPORT_CLASS}
			>
				{/* Upstream `KS`: the pinned client-health notice slot, kept empty locally. */}
				<div role="status" aria-live="polite" className="sr-only" />
				{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Base UI Toast.Viewport: hover/focus expand the deck, Shift+Tab on the region restores the pre-F6 element */}
				<div
					ref={region}
					tabIndex={-1}
					role="region"
					aria-live="polite"
					aria-atomic={false}
					aria-relevant="additions text"
					aria-label="Notifications"
					{...(toasts.length > 0
						?
							{
								"data-focus-region": "notifications",
							}
						: {})}
					data-expanded={expanded ? "" : undefined}
					className={REGION_CLASS}
					style={
					{
						height: frontHeight,
					}}
					onMouseEnter={() =>
					{
						setHovered(true);
					}}
					onMouseLeave={() =>
					{
						setHovered(false);
					}}
					onFocus={(event) =>
					{
						const from = event.relatedTarget;
						if (from instanceof HTMLElement && !event.currentTarget.contains(from))
						{
							prevFocus.current = from;
						}
						setRegionFocused(true);
					}}
					onBlur={(event) =>
					{
						const to = event.relatedTarget;
						if (to instanceof Node && event.currentTarget.contains(to)) return;
						setRegionFocused(false);
					}}
					onKeyDown={(event) =>
					{
						if (event.key === "Tab" && event.shiftKey && event.target === event.currentTarget)
						{
							event.preventDefault();
							prevFocus.current?.focus();
						}
					}}
				>
					{newestFirst.map((t, depth) => (
						<ToastItem
							key={t.id}
							entry={t}
							depth={depth}
							paused={paused}
							expanded={expanded}
							regionFocused={regionFocused}
							fizzyColor={fizzyColor}
							onDismiss={dismiss}
							onClose={close}
						/>
					))}
				</div>
				{!regionFocused && dangers.length > 0 && (
					<div style={VISUALLY_HIDDEN}>
						{dangers.map((t) => (
							<div key={t.id} role="alert" aria-atomic="true">
								<div>{t.message}</div>
								<div>{t.description}</div>
							</div>
						))}
					</div>
				)}
			</div>
		</ToastContext.Provider>
	);
}

/*
 * Upstream `b_` / `P6`: Info (U+E08F), Warning (U+F082 filled under KH()) and WarningCircle
 * (U+F081 filled under KH()), each a 20px glyph; see dumps/toast-adderror-warning-variant-live-2026-11-07.txt.
 */
function WarningFilledIcon()
{
	return (
		<svg data-toast-icon="warning" data-filled="" aria-hidden="true" width={20} height={20} viewBox="0 0 20 20">
			<path
				fill="currentColor"
				fillRule="evenodd"
				d="M8.48 2.88a1.75 1.75 0 0 1 3.04 0l6.27 11.1a1.75 1.75 0 0 1-1.52 2.62H3.73a1.75 1.75 0 0 1-1.52-2.62zM9.25 7.25a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0zM10 12.6a.9.9 0 1 1 0 1.8.9.9 0 1 1 0-1.8z"
			/>
		</svg>
	);
}

function WarningCircleFilledIcon()
{
	return (
		<svg data-toast-icon="danger" data-filled="" aria-hidden="true" width={20} height={20} viewBox="0 0 20 20">
			<path
				fill="currentColor"
				fillRule="evenodd"
				d="M10 2a8 8 0 1 1 0 16 8 8 0 1 1 0-16zM9.25 6.25a.75.75 0 0 1 1.5 0v4.5a.75.75 0 0 1-1.5 0zM10 12.6a.9.9 0 1 1 0 1.8.9.9 0 1 1 0-1.8z"
			/>
		</svg>
	);
}

function ToastGlyph({variant, fizzyColor}: {variant: ToastVariant; fizzyColor: boolean})
{
	switch (variant)
	{
		case "danger":
			return fizzyColor ? (
				<WarningCircleFilledIcon />
			) : (
				<CircleAlert data-toast-icon="danger" aria-hidden="true" size={20} />
			);
		case "warning":
			return fizzyColor ? (
				<WarningFilledIcon />
			) : (
				<TriangleAlert data-toast-icon="warning" aria-hidden="true" size={20} />
			);
		default:
			return <Info data-toast-icon="info" aria-hidden="true" size={20} />;
	}
}

function ToastIcon({variant, fizzyColor}: {variant: ToastVariant; fizzyColor: boolean})
{
	const ink = iconInk(variant, fizzyColor);
	return (
		<span className={ink === "" ? "shrink-0" : `shrink-0 ${ink}`}>
			<ToastGlyph variant={variant} fizzyColor={fizzyColor} />
		</span>
	);
}

/** Upstream `wS("popover")`: the card outlines itself in CanvasText under forced colors. */
const CARD_CLASS =
	"absolute right-0 bottom-0 flex w-full origin-bottom items-start gap-2 rounded-card forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText] px-4 py-3 text-body transition-transform duration-200 ease-out motion-safe:animate-[toast-in_150ms_ease-out]";

function ToastItem({
	entry,
	depth,
	paused,
	expanded,
	regionFocused,
	fizzyColor,
	onDismiss,
	onClose,
}: {
	entry: ToastEntry;
	/** 0 for the front toast, 1 for the one behind it, and so on. */
	depth: number;
	/** The deck is hovered or focused, or the window is blurred. */
	paused: boolean;
	/** Base UI `expanded`: the deck is hovered or focused. */
	expanded: boolean;
	/** Focus is inside the Notifications region. */
	regionFocused: boolean;
	/** Upstream `KH()`: fizzy-lake color on, so the card drops its tint and the glyphs fill. */
	fizzyColor: boolean;
	/** Timer expiry: drop the toast without touching focus. */
	onDismiss: (id: number) => void;
	/** A user close (Escape, Dismiss, action): hand focus off, then drop the toast. */
	onClose: (id: number, root: HTMLElement) => void;
})
{
	const {id, message, description, kind, action, count, repeat} = entry;
	const titleId = useId();
	const descriptionId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const [closeFocused, setCloseFocused] = useState(false);
	const duration = durationFor(entry);
	const remaining = useRef(duration);
	const appliedRepeat = useRef(repeat);

	useEffect(() =>
	{
		// A repeat keeps the toast up at least REPEAT_MIN_MS from now; the cleanup already took off the elapsed time.
		if (repeat !== appliedRepeat.current)
		{
			appliedRepeat.current = repeat;
			if (remaining.current !== null) remaining.current = Math.max(remaining.current, REPEAT_MIN_MS);
		}
		if (paused || remaining.current === null) return undefined;
		const startedAt = Date.now();
		const timer = setTimeout(() =>
		{
			onDismiss(id);
		}, remaining.current);
		return () =>
		{
			clearTimeout(timer);
			if (remaining.current !== null) remaining.current -= Date.now() - startedAt;
		};
	}, [paused, id, onDismiss, repeat]);

	const close = () =>
	{
		if (rootRef.current !== null) onClose(id, rootRef.current);
	};
	const behind = depth > 0;
	const variant = VARIANT_OF[kind];
	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- role is dialog or alertdialog (Base UI Toast.Root); Escape closes the toast
		<div
			ref={rootRef}
			data-toast
			data-kind={kind}
			data-type={variant}
			data-behind={behind ? "" : undefined}
			data-expanded={expanded ? "" : undefined}
			role={variant === "danger" ? "alertdialog" : "dialog"}
			tabIndex={0}
			aria-modal={false}
			aria-labelledby={titleId}
			aria-describedby={description === undefined ? undefined : descriptionId}
			aria-hidden={variant === "danger" && !regionFocused ? true : undefined}
			style={
			{
				transform: `translateY(${depth * -DECK_OFFSET_PX}px) scale(${1 - depth * DECK_SCALE_STEP})`,
				zIndex: 100 - depth,
			}}
			className={`${CARD_CLASS} ${fizzyColor ? STACKS_CARD : PRE_FIZZY_CARD[variant]}`}
			onKeyDown={(event) =>
			{
				if (event.key === "Escape" && event.currentTarget.contains(document.activeElement)) close();
			}}
		>
			<div className={`flex min-w-0 flex-1 items-start gap-2 ${behind ? "invisible opacity-0" : ""}`}>
				<ToastIcon variant={variant} fizzyColor={fizzyColor} />
				<div className="min-w-0 flex-1 text-pretty break-words">
					<h2 id={titleId} data-toast-message="" aria-atomic="true" className="font-medium">
						<span>{message}</span>
						{count > 1 && (
							<span data-cds-toast-count="" aria-live={count > 2 ? "off" : undefined}>
								{` (×${count})`}
							</span>
						)}
					</h2>
					{description !== undefined && (
						<p id={descriptionId} className="text-secondary">
							{description}
						</p>
					)}
				</div>
				{action && (
					<button
						type="button"
						className="shrink-0 rounded-md border border-border px-2 py-0.5 text-sm font-medium hover:bg-fill-ghost-hover"
						onClick={() =>
						{
							close();
							action.onAction();
						}}
					>
						{action.label}
					</button>
				)}
				<button
					type="button"
					aria-label="Dismiss"
					aria-hidden={!expanded && !closeFocused ? true : undefined}
					data-type={variant}
					className="flex size-5 shrink-0 items-center justify-center rounded-lg p-1 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
					onFocus={() =>
					{
						setCloseFocused(true);
					}}
					onBlur={() =>
					{
						setCloseFocused(false);
					}}
					onClick={close}
				>
					<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
						<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					</svg>
				</button>
			</div>
		</div>
	);
}
