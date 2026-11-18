/*
 * Upstream's durable Code sends, gated by GrowthBook `claudeai_epitaxy_send_durability_main` (feature key
 * 3052038372) in the c6b8adeaf send mutation. With it on, a refused send stays in the transcript as a
 * "Not delivered · {time}" user row with Retry / Discard (`markPendingFailed`, persisted in the
 * `session-pending-messages` store), instead of the send-rejected error card and a composer refill. The key
 * was absent from GrowthBook (isOn false) for the live account on 2026-10-20, 2026-10-30 and 2026-11-01;
 * locally it ships on (upstream-sync M6, 11-04 Q2 answer c). Switching it off restores the card + refill.
 */
export const DURABLE_SENDS: boolean = true;
