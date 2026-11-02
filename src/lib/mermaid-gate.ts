import type {Mermaid} from "mermaid";
import {findSecrets} from "./secret-mask";

/*
 * Upstream's mermaid gate (c5071af19 `hn` and the pre-gate `Z`): whether a fence may try to draw at all. It stays
 * small and in the main bundle; the renderer and mermaid itself load lazily behind it.
 */

/** Upstream's source length limit in the pre-gate `Z`. */
const MERMAID_MAX_SOURCE = 262_144;

/**
 * Upstream's pre-gate `Z(code, true)`: a source this long, or with any secret in it, stays a code block (where the
 * secret cloak masks it) and never loads mermaid.
 */
export function mermaidSourceDrawable(code: string): boolean
{
	return code.length <= MERMAID_MAX_SOURCE && findSecrets(code).length === 0;
}

let mermaidModule: Promise<Mermaid> | undefined;
let loadFailed = false;
const loadListeners = new Set<() => void>();

/** Marks the diagram code as unloadable, as upstream's failed lazy chunk does: fences stay code blocks. */
export function noteMermaidLoadFailed(): void
{
	if (loadFailed) return;
	loadFailed = true;
	for (const listener of loadListeners) listener();
}

/** Upstream's `chunkFailed` half of the gate `hn()`. */
export function mermaidLoadFailed(): boolean
{
	return loadFailed;
}

export function subscribeMermaidLoad(listener: () => void): () => void
{
	loadListeners.add(listener);
	return () =>
	{
		loadListeners.delete(listener);
	};
}

/** Upstream `ic`: mermaid, imported once on first use. A failed import turns diagrams off for the page. */
export async function loadMermaid(): Promise<Mermaid>
{
	mermaidModule ??= import("mermaid").then(
		(module) => module.default,
		(error: unknown) =>
		{
			noteMermaidLoadFailed();
			throw error;
		},
	);
	return mermaidModule;
}
