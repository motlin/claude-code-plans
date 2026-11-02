import type {ReactNode} from "react";

import {useLanded} from "../lib/landed-store";

/** Upstream's `Cc` flash, drawn under a boxed user bubble's text. */
const LANDED_FLASH_CLASS =
	"epitaxy-reply-flash-accent pointer-events-none absolute inset-0 -z-[1] rounded-[inherit] animate-code-reply-flash-accent motion-reduce:animate-none motion-reduce:bg-upstream-accent-pressed";

/**
 * Upstream's "landed" accent flash (`Di`) on the user row a promoted queued message became: the
 * accent span to put inside the bubble, and the `isolate` the bubble takes while it shows.
 */
export function useLandedFlash(text: string):
{
	isolate: string;
	accent: ReactNode;
}
{
	const landed = useLanded(text);
	return landed
		?
			{
				isolate: "isolate",
				accent: <span key="landed" aria-hidden className={LANDED_FLASH_CLASS} />,
			}
		:
			{
				isolate: "",
				accent: null,
			};
}
