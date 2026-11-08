import {CircleAlert, Info, TriangleAlert} from "lucide-react";
import {type ReactNode, useCallback, useEffect, useRef, useState} from "react";

import {useFizzyLake} from "../lib/fizzy-lake";
import {ToastContext, type ToastKind, type ToastOptions} from "./toast-context";

interface ToastEntry extends ToastOptions {
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

const REGION_CLASS = "pointer-events-none absolute inset-x-0 bottom-0";

/** Upstream's cds Toast variant: the bridge maps `toastType` ("info" → "neutral"). */
type ToastVariant = "neutral" | "warning" | "danger";

/** Upstream `GY`: addError, addApiError and addWarning all store `toastType: "warning"`. */
const VARIANT_OF = {
	success: "neutral",
	warning: "warning",
	error: "warning",
	danger: "danger",
} as const satisfies Record<ToastKind, ToastVariant>;

/** Upstream's `stacks:shadow-panel-md stacks:bg-none stacks:text-primary`: fizzy color drops the tint. */
const STACKS_CARD = "bg-surface-popover text-primary shadow-panel-md";

/** Upstream `Zq` + `V9` without fizzy color: the card is tinted, ringed and inked by its variant. */
const PRE_FIZZY_CARD = {
	neutral: STACKS_CARD,
	warning:
		"bg-[color-mix(in_srgb,var(--color-warning-100)_10%,var(--color-surface-popover))] text-warning-000 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-warning-100)_35%,transparent),var(--shadow-panel-md)]",
	danger: "bg-[color-mix(in_srgb,var(--color-danger-100)_10%,var(--color-surface-popover))] text-danger-000 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-danger-100)_35%,transparent),var(--shadow-panel-md)]",
} as const satisfies Record<ToastVariant, string>;

/** Upstream `TQ`: the icon wrap's ink; without fizzy color warning/danger inherit the card ink. */
function iconInk(variant: ToastVariant, fizzyColor: boolean): string {
	if (variant === "neutral") return "text-secondary";
	if (!fizzyColor) return "";
	return variant === "warning" ? "text-fill-warning" : "text-fill-danger";
}

function sameToast(a: ToastOptions, b: ToastOptions): boolean {
	return VARIANT_OF[a.kind] === VARIANT_OF[b.kind] && a.message === b.message && a.description === b.description;
}

function durationFor(entry: ToastEntry): number | null {
	if (entry.durationMs !== undefined) return entry.durationMs;
	if (entry.action !== undefined) return null;
	return VARIANT_OF[entry.kind] === "neutral" ? NEUTRAL_DURATION_MS : ALERT_DURATION_MS;
}

/**
 * Upstream's toasts: a deck stacked bottom-right (the newest in front, older ones peeking 14px
 * above it), auto-dismissing (paused while hovered or focused) unless they carry an action such as
 * [Undo]. A repeat folds into the open toast as "(×2)". Success toasts announce politely; warnings
 * and errors announce assertively.
 */
export function ToastProvider({children}: Readonly<{children: ReactNode}>) {
	const [toasts, setToasts] = useState<ToastEntry[]>([]);
	const nextId = useRef(0);
	const fizzyColor = useFizzyLake("color");

	const dismiss = useCallback((id: number) => {
		setToasts((current) => current.filter((t) => t.id !== id));
	}, []);

	const toast = useCallback((options: ToastOptions) => {
		const {signal} = options;
		if (signal?.aborted === true) return;
		setToasts((current) => {
			const open = current.find((entry) => sameToast(entry, options));
			if (open !== undefined) {
				return current.map((entry) =>
					entry === open ? {...entry, count: entry.count + 1, repeat: entry.repeat + 1} : entry,
				);
			}
			nextId.current += 1;
			return [...current, {...options, id: nextId.current, count: 1, repeat: 0}];
		});
		signal?.addEventListener(
			"abort",
			() => {
				setToasts((current) => current.filter((t) => t.signal !== signal));
			},
			{once: true},
		);
	}, []);

	const depthOf = (entry: ToastEntry) => toasts.length - 1 - toasts.indexOf(entry);
	return (
		<ToastContext.Provider value={toast}>
			{children}
			<div
				data-position="bottom-right"
				{...(toasts.length > 0 ? {"data-focus-region": "notifications"} : {})}
				className="pointer-events-none fixed right-4 bottom-4 z-[100] w-[360px] max-w-[calc(100vw-2rem)]"
			>
				<div role="status" aria-live="polite" className={REGION_CLASS}>
					{toasts
						.filter((t) => t.kind === "success")
						.map((t) => (
							<ToastItem
								key={t.id}
								entry={t}
								depth={depthOf(t)}
								fizzyColor={fizzyColor}
								onDismiss={dismiss}
							/>
						))}
				</div>
				<div role="alert" aria-live="assertive" className={REGION_CLASS}>
					{toasts
						.filter((t) => t.kind !== "success")
						.map((t) => (
							<ToastItem
								key={t.id}
								entry={t}
								depth={depthOf(t)}
								fizzyColor={fizzyColor}
								onDismiss={dismiss}
							/>
						))}
				</div>
			</div>
		</ToastContext.Provider>
	);
}

/*
 * Upstream `b_` / `P6`: Info (U+E08F), Warning (U+F082 filled under KH()) and WarningCircle
 * (U+F081 filled under KH()), each a 20px glyph; see dumps/toast-adderror-warning-variant-live-2026-11-07.txt.
 */
function WarningFilledIcon() {
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

function WarningCircleFilledIcon() {
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

function ToastGlyph({variant, fizzyColor}: {variant: ToastVariant; fizzyColor: boolean}) {
	switch (variant) {
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

function ToastIcon({variant, fizzyColor}: {variant: ToastVariant; fizzyColor: boolean}) {
	const ink = iconInk(variant, fizzyColor);
	return (
		<span className={ink === "" ? "shrink-0" : `shrink-0 ${ink}`}>
			<ToastGlyph variant={variant} fizzyColor={fizzyColor} />
		</span>
	);
}

function ToastItem({
	entry,
	depth,
	fizzyColor,
	onDismiss,
}: {
	entry: ToastEntry;
	/** 0 for the front toast, 1 for the one behind it, and so on. */
	depth: number;
	/** Upstream `KH()`: fizzy-lake color on, so the card drops its tint and the glyphs fill. */
	fizzyColor: boolean;
	onDismiss: (id: number) => void;
}) {
	const {id, message, description, kind, action, count, repeat} = entry;
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const duration = durationFor(entry);
	const remaining = useRef(duration);
	const appliedRepeat = useRef(repeat);
	const paused = hovered || focused;

	useEffect(() => {
		// A repeat keeps the toast up at least REPEAT_MIN_MS from now; the cleanup already took off the elapsed time.
		if (repeat !== appliedRepeat.current) {
			appliedRepeat.current = repeat;
			if (remaining.current !== null) remaining.current = Math.max(remaining.current, REPEAT_MIN_MS);
		}
		if (paused || remaining.current === null) return undefined;
		const startedAt = Date.now();
		const timer = setTimeout(() => {
			onDismiss(id);
		}, remaining.current);
		return () => {
			clearTimeout(timer);
			if (remaining.current !== null) remaining.current -= Date.now() - startedAt;
		};
	}, [paused, id, onDismiss, repeat]);

	const behind = depth > 0;
	const variant = VARIANT_OF[kind];
	return (
		<div
			data-toast
			data-cds="Toast"
			data-kind={kind}
			data-type={variant}
			data-behind={behind ? "" : undefined}
			style={{
				transform: `translateY(${depth * -DECK_OFFSET_PX}px) scale(${1 - depth * DECK_SCALE_STEP})`,
				zIndex: 100 - depth,
			}}
			className={`pointer-events-auto absolute right-0 bottom-0 flex w-full origin-bottom items-start gap-2 rounded-card px-4 py-3 text-body transition-transform duration-200 ease-out motion-safe:animate-[toast-in_150ms_ease-out] ${fizzyColor ? STACKS_CARD : PRE_FIZZY_CARD[variant]}`}
			onMouseEnter={() => {
				setHovered(true);
			}}
			onMouseLeave={() => {
				setHovered(false);
			}}
			onFocus={() => {
				setFocused(true);
			}}
			onBlur={() => {
				setFocused(false);
			}}
		>
			<div className={`flex min-w-0 flex-1 items-start gap-2 ${behind ? "invisible opacity-0" : ""}`}>
				<ToastIcon variant={variant} fizzyColor={fizzyColor} />
				<div className="min-w-0 flex-1">
					<p data-toast-message>{count > 1 ? `${message} (×${count})` : message}</p>
					{description !== undefined && <p className="mt-0.5 text-secondary">{description}</p>}
				</div>
				{action && (
					<button
						type="button"
						className="shrink-0 rounded-md border border-border px-2 py-0.5 text-sm font-medium hover:bg-fill-ghost-hover"
						onClick={() => {
							onDismiss(id);
							action.onAction();
						}}
					>
						{action.label}
					</button>
				)}
				<button
					type="button"
					aria-label="Dismiss"
					className="flex size-5 shrink-0 items-center justify-center rounded-lg p-1 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
					onClick={() => {
						onDismiss(id);
					}}
				>
					<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
						<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					</svg>
				</button>
			</div>
		</div>
	);
}
