import {createContext} from "react";

import type {RefusalOptOutView} from "../hooks/use-refusal-opt-out";
import type {RefusalFallback} from "../lib/refusal-fallback";

/** The fields of a `model_refusal_fallback` row the card draws. */
export interface ModelSwitchedRecord
{
	uuid: string;
	originalModel: string;
	fallbackModel: string;
	/** The API's raw refusal category, drawn as the "Details: [raw]" line. */
	apiRefusalCategory: string | null;
	apiRefusalExplanation: string | null;
}

/** The settings sentence's binding (`useRefusalOptOut`). */
export interface RefusalSettingsLink
{
	view: RefusalOptOutView;
	openSettings: () => void;
}

/** Upstream c01e7498d `gh()`, the session's model-switched host, published by the session page. */
export interface RefusalFallbackHost
{
	sessionId: string;
	/** Upstream `bannerUuid`'s fallback: the live one, which alone gets an action. */
	live: RefusalFallback | null;
	/** An approval or question card holds the session. */
	held: boolean;
	/** Starts a new session on the given model; undefined when the session's folder is unknown. */
	onNewSession: ((model: string) => void) | undefined;
	/** Upstream's `onEditPromptRetry` (refusal-edit-retry-rewind); undefined when the session can't rewind now. */
	onEditRetry: (() => boolean) | undefined;
}

/** Null outside a session page: upstream then draws `Ey`, which shows nothing in English. */
export const RefusalFallbackHostContext = createContext<RefusalFallbackHost | null>(null);

/* Upstream `Qs("model-switched:"+id)`: a card's open choice outlives its row's remounts. */
export const modelSwitchedOpenMemory = new Map<string, boolean>();

/** Test hook: forgets every remembered open choice. */
export function resetModelSwitchedOpenMemory(): void
{
	modelSwitchedOpenMemory.clear();
}
