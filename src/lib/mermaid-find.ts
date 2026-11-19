import {createContext} from "react";

/*
 * In-page find over mermaid fences (upstream c5071af19 `Cn`/`Dn`, ca8b34310 `gd`'s mermaid half, cb6930dae `sd`/`pd`;
 * dumps/mermaid-fence-find-source-visibility-bundle-2026-11-18.js.txt). A drawn diagram is not searchable text: while
 * find is enabled its wrapper is omitted from the walk, and its source counts only while the fence shows that source,
 * which the fence reports into the transcript's store under its block id and code.
 */

/** Upstream ca8b34310 `Lc`: in-page find is enabled for this surface. The transcript provides true. */
export const FindEnabledContext = createContext(false);

/** Upstream `Ht`: the id of the transcript text block a fence sits in. */
export const MermaidBlockIdContext = createContext<string | undefined>(undefined);

/** The block id a reply's text or narration block provides, by its index in the message content. */
export function mermaidBlockId(messageUuid: string | undefined, blockIndex: number): string
{
	return `${messageUuid ?? ""}:${blockIndex}`;
}

/** Upstream `gn`/`ro`: a fence's key in the store, its block id and its code. */
export function mermaidSourceKey(blockId: string | undefined, code: string): string
{
	return `${blockId ?? ""}\n${code}`;
}

export interface MermaidSourceState
{
	/** Upstream `visibleBodiesVersion`: bumped on every visibility change, so search text recounts. */
	readonly version: number;
	readonly setMermaidSourceVisible: (key: string, visible: boolean) => void;
	readonly isMermaidSourceVisible: (key: string) => boolean;
}

export interface MermaidSourceStore
{
	getState: () => MermaidSourceState;
	subscribe: (listener: () => void) => () => void;
}

/** Upstream `gd`'s `setMermaidSourceVisible`/`isMermaidSourceVisible`. */
export function createMermaidSourceStore(): MermaidSourceStore
{
	const visible = new Set<string>();
	const listeners = new Set<() => void>();
	let state: MermaidSourceState =
	{
		version: 0,
		setMermaidSourceVisible: (key, shown) =>
		{
			if (visible.has(key) === shown) return;
			if (shown) visible.add(key);
			else visible.delete(key);
			state =
			{
				...state,
				version: state.version + 1,
			};
			for (const listener of listeners) listener();
		},
		isMermaidSourceVisible: (key) => visible.has(key),
	};
	return {
		getState: () => state,
		subscribe: (listener) =>
		{
			listeners.add(listener);
			return () =>
			{
				listeners.delete(listener);
			};
		},
	};
}

/** Upstream `xd`, defaulting to the shared `bd` store outside a transcript. */
export const MermaidSourceStoreContext = createContext<MermaidSourceStore>(createMermaidSourceStore());
