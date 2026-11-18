/**
 * Upstream's ⌘/Ctrl+click on a Changes line number opens the file at that line (c44d00c7f `Gu`). Upstream gates it
 * with the kill switch `__gb__2858289023` (`Wu() = !he("__gb__2858289023")`): on while the gate is off, as it is on
 * the live account. Local turns it on (upstream-sync M6); set this to false to fall back to inert numbers.
 */
export const LINE_NUMBER_OPENS_FILE: boolean = true;
