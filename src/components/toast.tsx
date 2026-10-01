import {Info, TriangleAlert} from "lucide-react";
import {createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState} from "react";

export type ToastKind = "success" | "error";

export interface ToastAction {
	label: string;
	onAction: () => void;
}

export interface ToastOptions {
	message: string;
	kind: ToastKind;
	description?: string;
	action?: ToastAction;
	durationMs?: number;
}

interface ToastEntry extends ToastOptions {
	id: number;
}

const DEFAULT_DURATION_MS = 4000;

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

export function useToast(): (options: ToastOptions) => void {
	const toast = useContext(ToastContext);
	if (!toast) {
		throw new Error("useToast must be used within a ToastProvider");
	}
	return toast;
}

const REGION_CLASS = "flex w-full flex-col items-end gap-2";

/**
 * Upstream-style toasts: compact cards stacked bottom-right, auto-dismissing (paused while
 * hovered or focused), with an optional action such as [Undo]. Success toasts
 * announce politely; errors announce assertively.
 */
export function ToastProvider({children}: Readonly<{children: ReactNode}>) {
	const [toasts, setToasts] = useState<ToastEntry[]>([]);
	const nextId = useRef(0);

	const toast = useCallback((options: ToastOptions) => {
		nextId.current += 1;
		const entry: ToastEntry = {...options, id: nextId.current};
		setToasts((current) => [...current, entry]);
	}, []);

	const dismiss = useCallback((id: number) => {
		setToasts((current) => current.filter((t) => t.id !== id));
	}, []);

	return (
		<ToastContext.Provider value={toast}>
			{children}
			<div
				data-position="bottom-right"
				className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col items-end gap-2"
			>
				<div role="status" aria-live="polite" className={REGION_CLASS}>
					{toasts
						.filter((t) => t.kind === "success")
						.map((t) => (
							<ToastItem key={t.id} entry={t} onDismiss={dismiss} />
						))}
				</div>
				<div role="alert" aria-live="assertive" className={REGION_CLASS}>
					{toasts
						.filter((t) => t.kind === "error")
						.map((t) => (
							<ToastItem key={t.id} entry={t} onDismiss={dismiss} />
						))}
				</div>
			</div>
		</ToastContext.Provider>
	);
}

function ToastItem({entry, onDismiss}: {entry: ToastEntry; onDismiss: (id: number) => void}) {
	const {id, message, description, kind, action} = entry;
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const remaining = useRef(entry.durationMs ?? DEFAULT_DURATION_MS);
	const paused = hovered || focused;

	useEffect(() => {
		if (paused) return undefined;
		const startedAt = Date.now();
		const timer = setTimeout(() => onDismiss(id), remaining.current);
		return () => {
			clearTimeout(timer);
			remaining.current -= Date.now() - startedAt;
		};
	}, [paused, id, onDismiss]);

	return (
		<div
			data-toast
			data-kind={kind}
			className="pointer-events-auto flex max-w-[360px] items-start gap-3 rounded-card bg-surface-popover px-4 py-3 text-sm text-primary shadow-panel-sm motion-safe:animate-[toast-in_150ms_ease-out]"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
		>
			{kind === "error" ? (
				<TriangleAlert
					data-toast-icon="warning"
					aria-hidden="true"
					size={17}
					className="mt-px shrink-0 text-danger-000"
				/>
			) : (
				<Info data-toast-icon="info" aria-hidden="true" size={17} className="mt-px shrink-0 text-secondary" />
			)}
			<div className="min-w-0 flex-1">
				<p data-toast-message className={kind === "error" ? "text-danger-000" : undefined}>
					{message}
				</p>
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
				onClick={() => onDismiss(id)}
			>
				<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
					<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</svg>
			</button>
		</div>
	);
}
