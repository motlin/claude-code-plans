/** Upstream `P7`: how long `m7` waits before opening a dialog from a closing surface. */
export const OVERLAY_OPEN_DELAY_MS = 100;

/** Upstream `NM`: a note older than this is stale. */
export const OVERLAY_OPEN_NOTE_WINDOW_MS = 500;

let note:
{
	notedAt: number;
	opensInMs: number;
} | null = null;

/** Upstream `X7`: an overlay will open in `opensInMs`, so a closing palette can hand its scrim to it. */
export function noteOverlayOpening(opensInMs: number): void
{
	note =
	{
		notedAt: performance.now(),
		opensInMs,
	};
}

/** Upstream `NM`: consumes the note, returning its delay while it is fresher than 500ms. */
export function takeOverlayOpeningNote(): number | null
{
	const taken = note;
	note = null;
	return taken !== null && performance.now() - taken.notedAt < OVERLAY_OPEN_NOTE_WINDOW_MS ? taken.opensInMs : null;
}

/** Upstream `m7`: opens `open` after 100ms, noting it first when it opens a dialog. */
export function runAfterOverlayDelay(open: () => void, kind?: "dialog"): void
{
	if (kind === "dialog") noteOverlayOpening(OVERLAY_OPEN_DELAY_MS);
	setTimeout(open, OVERLAY_OPEN_DELAY_MS);
}
