import {useCallback, useContext} from "react";

import {openFileInDefaultApp} from "../lib/api/file";
import {ApiResponseError} from "../lib/api/client";
import {ToastContext} from "./toast-context";

/**
 * Open a file with its default app, toasting upstream's error when that
 * fails. Like upstream, a refusal (403: outside the roots, a folder, an
 * executable) stays silent. Outside a toast provider every failure is silent.
 */
export function useOpenInDefaultApp(): (path: string) => void {
	const toast = useContext(ToastContext);
	return useCallback(
		(path) => {
			openFileInDefaultApp(path).catch((error: unknown) => {
				if (error instanceof ApiResponseError && error.status === 403) return;
				toast?.({kind: "error", message: "Couldn’t open this file with the default app."});
			});
		},
		[toast],
	);
}
