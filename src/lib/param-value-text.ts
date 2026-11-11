import {maskSecrets} from "./secret-mask";
import {revealControlChars} from "./visible-text";

/** Upstream's `Id` (shared-40): one terminal escape sequence (CSI, a string sequence, or a short escape). */
const ESCAPE_SEQUENCE_RE =
	// eslint-disable-next-line no-control-regex -- matching escape sequences is the point
	/\x1b(?:\[[0-9:;<=>?]*[ -/]*[@-~]|[\]P^_Xk][^\x07\x1b]*(?:\x07|\x1b\\)?|[ -/]*[0-OQ-WYZ\\`a-jl-~])/g;

/**
 * Upstream's tool-call param value (c62da1b56 `R`, applied to every string row value by cb6930dae `fm`): the
 * controls shown as `[U+XXXX]` (`Jr`). Only text holding both a control and a secret is masked here: the secret
 * bulleted in place with the escape sequences stripped, then each sequence listed on its own line. Any other
 * secret is left for the row's renderer to cloak.
 */
export function paramValueText(value: string): string {
	const stripped = value.replace(ESCAPE_SEQUENCE_RE, "");
	const masked = maskSecrets(stripped);
	const hasControls = revealControlChars(value) !== value;
	return revealControlChars(
		hasControls && masked !== stripped
			? [masked, ...Array.from(value.matchAll(ESCAPE_SEQUENCE_RE), ([sequence]) => sequence)].join("\n")
			: value,
	);
}
