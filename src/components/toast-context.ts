import {createContext, useContext} from "react";

/**
 * `error` is upstream's `addError` (renders the warning variant, as upstream's does); `danger` is
 * `addDanger`; `warning` is `addWarning`; `success` is `addInfo`/`addSuccess` (neutral).
 */
export type ToastKind = "success" | "warning" | "error" | "danger";

export interface ToastAction {
	label: string;
	onAction: () => void;
}

export interface ToastOptions {
	message: string;
	kind: ToastKind;
	description?: string;
	action?: ToastAction;
	/** How long the toast stays up; null keeps it up until dismissed or `signal` aborts. */
	durationMs?: number | null;
	/** Dismisses the toast when aborted, as upstream's `clearToast` does. */
	signal?: AbortSignal;
	/** Upstream's uniqueKey: a toast with the same key closes the open one and enters fresh (never folds as "(×N)"). */
	uniqueKey?: string;
}

export const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

export function useToast(): (options: ToastOptions) => void {
	const toast = useContext(ToastContext);
	if (!toast) {
		throw new Error("useToast must be used within a ToastProvider");
	}
	return toast;
}
