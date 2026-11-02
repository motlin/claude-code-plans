import {useEffect, useRef} from "react";

/** The slice of the CloseWatcher API (Chromium's Android back gesture) that a sheet needs. */
interface CloseWatcherLike
{
	onclose: (() => void) | null;
	destroy: () => void;
}

type CloseWatcherConstructor = new () => CloseWatcherLike;

/** How long the swallow of the back gesture's trailing pointerup or keydown stays armed. */
const SWALLOW_WINDOW_MS = 1000;

/** Upstream's Sp: CloseWatcher drives dismissal only on Android, where it maps to the system back gesture. */
function isAndroid(view: Window): boolean
{
	const nav = view.navigator as Navigator &
	{
		userAgentData?:
		{
			platform?: string;
		};
	};
	return /android/i.test(nav.userAgentData?.platform ?? "") || /android/i.test(nav.userAgent);
}

/** Upstream's zs: the back gesture's trailing pointerup or keydown must not reach the page behind the sheet. */
function swallowNextInput(doc: Document)
{
	const view = doc.defaultView;
	const types = ["pointerup", "keydown"] as const;
	const stop = () =>
	{
		for (const type of types) doc.removeEventListener(type, swallow, true);
		if (view !== null) view.clearTimeout(timer);
	};
	const swallow = (event: Event) =>
	{
		event.preventDefault();
		event.stopPropagation();
		stop();
	};
	for (const type of types) doc.addEventListener(type, swallow, true);
	const timer = view === null ? 0 : view.setTimeout(stop, SWALLOW_WINDOW_MS);
}

/**
 * While `active`, an Android back gesture closes the sheet through a CloseWatcher and swallows the input that
 * trails it. Elsewhere, or where CloseWatcher is missing, it does nothing.
 */
export function useCloseWatcher(target: Element | null, onClose: () => void)
{
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	useEffect(() =>
	{
		const doc = target?.ownerDocument;
		const view = doc?.defaultView;
		if (doc === undefined || view === null || view === undefined) return undefined;
		const Watcher = (
			view as Window &
			{
				CloseWatcher?: CloseWatcherConstructor;
			}
		).CloseWatcher;
		if (Watcher === undefined || !isAndroid(view)) return undefined;
		let watcher: CloseWatcherLike;
		try
		{
			watcher = new Watcher();
		}
		catch
		{
			return undefined;
		}
		watcher.onclose = () =>
		{
			swallowNextInput(doc);
			onCloseRef.current();
		};
		return () =>
		{
			watcher.onclose = null;
			watcher.destroy();
		};
	}, [target]);
}
