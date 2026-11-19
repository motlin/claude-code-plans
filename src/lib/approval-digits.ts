/**
 * Upstream's approval card digit keys (shared-3 `Fa` with shared-0 `lL`/`Pi`/`DP`/`$0`): the live actions behind
 * digits 1..n on an approval card, and the ownership checks other key handlers read.
 */

/**
 * One digit's action: Deny, Allow once, the persistent option (held on the inline card, so its digit does nothing),
 * or an entry that is disabled or busy and does nothing.
 */
export type DigitEntry = "deny" | "once" | "held" | "dead";

/** The card root attribute holding the live digit count (upstream's `data-approval-card-digits`). */
const APPROVAL_CARD_DIGITS_ATTR = "data-approval-card-digits";

/**
 * Upstream's `lL(deny, Ya)` for the inline permission card: digit 1 is Deny and the last digit is Allow once. A
 * persistent option offered inline sits between them as a held entry, so `2` does nothing and `3` allows once.
 */
export function permissionDigitEntries({
	persistentOffered,
	allowDisabled,
	denyDisabled,
}: {
	persistentOffered: boolean;
	/** Allow once is disabled or busy (a read gate holds it, or an answer is being sent). */
	allowDisabled: boolean;
	/** Deny is disabled or busy. */
	denyDisabled: boolean;
}): DigitEntry[]
{
	const deny: DigitEntry = denyDisabled ? "dead" : "deny";
	const once: DigitEntry = allowDisabled ? "dead" : "once";
	return persistentOffered ? [deny, "held", once] : [deny, once];
}

/** Upstream's `Pi`: the entries' layout, a dash for each that does nothing, so a change re-arms the non-deny digits. */
export function digitLayoutKey(entries: readonly DigitEntry[]): string
{
	return entries.map((entry) => (entry === "held" || entry === "dead" ? "-" : entry)).join(",");
}

/** Upstream's `DP`: the key is a digit that the approval card holding `active` takes. */
export function cardOwnsDigit(key: string, active: Element | null): boolean
{
	if (!/^[1-9]$/.test(key)) return false;
	const digits = active?.closest(`[${APPROVAL_CARD_DIGITS_ATTR}]`)?.getAttribute(APPROVAL_CARD_DIGITS_ATTR);
	return digits != null && Number(key) <= Number(digits);
}

/** Upstream's `$0`: a button's label digit (`[data-approval-digit]`), or null. */
export function buttonDigit(element: Element | null): number | null
{
	if (!(element instanceof HTMLButtonElement)) return null;
	const digit = element.querySelector("[data-approval-digit]")?.getAttribute("data-approval-digit");
	return digit == null ? null : Number(digit);
}
