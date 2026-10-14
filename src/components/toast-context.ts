import {createContext, useContext} from "react";

export type ToastKind = "success" | "warning" | "error";

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

export const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

export function useToast(): (options: ToastOptions) => void {
	const toast = useContext(ToastContext);
	if (!toast) {
		throw new Error("useToast must be used within a ToastProvider");
	}
	return toast;
}
