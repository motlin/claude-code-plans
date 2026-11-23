import {createContext} from "react";

import type {HardBlock} from "../lib/hard-block";

/** Upstream cf6ae6197 `Fc`'s `scopeStore.hardBlockCards`, plus the selectors `j_` reads. */
export interface HardBlockHost
{
	/** Upstream `Ki`: the newest turn's block, null while a turn is in flight. */
	latest: HardBlock | null;
	/** Upstream `Yi`: the block an older refusal row ends its turn with. */
	blockAt: (uuid: string) => HardBlock | null;
	/** An approval or question card holds the session. */
	held: boolean;
	/** Starts Edit and retry for a card; true when a rewind started. Undefined when the session can't rewind. */
	onEditRetry: ((uuid: string) => boolean) | undefined;
	editRetryBusyFor: string | null;
	/** Upstream `Fc`'s `sessionModel`: names the model on the newest card when its turn has none. */
	sessionModel: string | null;
}

/** Published by the session page while HARD_BLOCK_CARDS is on; null draws the legacy card. */
export const HardBlockHostContext = createContext<HardBlockHost | null>(null);

/* Upstream `Sa("hard-block:"+uuid)`: a card's open choice outlives its row's remounts. */
export const hardBlockOpenMemory = new Map<string, boolean>();

/** Test hook: forgets every remembered open choice. */
export function resetHardBlockOpenMemory(): void
{
	hardBlockOpenMemory.clear();
}
