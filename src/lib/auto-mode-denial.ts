/** What the auto-mode classifier's refusal leaves on a tool call; upstream's `policyDenied` fields. */
export interface AutoModeDenial
{
	blocked: true;
	/** The classifier's stated reason, absent when it gave none or only a placeholder. */
	blockedReason?: string;
	/** The check gave no verdict at all (upstream `policyDenialNoVerdict`). */
	blockedNoVerdict?: "unanswered";
}

const CLASSIFIER_DENIAL_PREFIX =
	"Permission for this action was denied by the Claude Code auto mode classifier. Reason: ";
const CLASSIFIER_DENIAL_TAIL = ". If you have other tasks";
const MAX_REASON_LENGTH = 1000;

/** Reasons the classifier writes when it has none to give (upstream `Fc`). */
const NO_REASON_PLACEHOLDERS: ReadonlySet<string> = new Set([
	"Blocked by classifier",
	"Blocked by fast classifier",
	"No reason provided",
	"The server-side auto mode classifier judged this action dangerous (it gave no explanation)",
]);

/** Upstream `Uc`/`zc`: the reason between the classifier prefix and its boilerplate tail, normalized. */
function classifierReason(resultText: string): string | undefined
{
	if (!resultText.startsWith(CLASSIFIER_DENIAL_PREFIX)) return undefined;
	const rest = resultText.slice(CLASSIFIER_DENIAL_PREFIX.length);
	const tail = rest.indexOf(CLASSIFIER_DENIAL_TAIL);
	const reason = (tail === -1 ? rest : rest.slice(0, tail)).replace(/\s+/g, " ").trim();
	if (reason === "" || NO_REASON_PLACEHOLDERS.has(reason)) return undefined;
	if (reason.length <= MAX_REASON_LENGTH) return reason;
	return `${reason.slice(0, MAX_REASON_LENGTH).replace(/\s\S*$/, "")}…`;
}

/**
 * Upstream `Ll` + `qc`: an auto-mode classifier refusal (`automode-blocked`) or a
 * check that gave no verdict (`automode-unavailable` / `automode-parsing-error`)
 * settles the call "Blocked". Any other kind, notably `permission-rule`, is not one.
 * Pass the full result text, not the truncated preview.
 */
export function autoModeDenial(kind: string | undefined, resultText: string): AutoModeDenial | null
{
	if (kind === "automode-unavailable" || kind === "automode-parsing-error")
	{
		return {
			blocked: true,
			blockedNoVerdict: "unanswered",
		};
	}
	if (kind !== "automode-blocked") return null;
	const reason = classifierReason(resultText);
	return reason === undefined
		?
			{
				blocked: true,
			}
		:
			{
				blocked: true,
				blockedReason: reason,
			};
}
