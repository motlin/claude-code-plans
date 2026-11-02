import {Fragment, type ReactNode} from "react";

import {pageIsRtl} from "../lib/page-direction";
import {findSecrets, maskSecrets, type SecretMatch} from "../lib/secret-mask";
import {revealSpoofing} from "../lib/visible-text";
import {SecretCloak} from "./secret-cloak";

/** Upstream's `qM` (shared-41): each line break drawn as a `<br>`, each line through `paintLine` when given. */
function withBreaks(text: string, key: string, paintLine?: (line: string) => ReactNode): ReactNode
{
	const lines = text.split(/\r\n?|\n/);
	if (lines.length === 1) return paintLine === undefined ? text : paintLine(text);
	return lines.map((line, index) => (
		<Fragment key={`${key}-${index}`}>
			{index > 0 && <br />}
			{paintLine === undefined ? line : paintLine(line)}
		</Fragment>
	));
}

/** Upstream's `E` (cb557955f): a word ending in 7+ bullets, as masking leaves a secret. */
const MASKED_WORD = /((?<![^\s\u2022])[^\s\u2022]+\u2022{7,})/;

/** Upstream's `D`: on a right-to-left page, a masked word holding a letter ends in a left-to-right mark. */
function markMaskedWords(line: string): ReactNode
{
	return line.split(MASKED_WORD).map((part, index) =>
		index % 2 === 1 && /[a-z]/i.test(part) ? (
			<span key={index} className={String.raw`after:content-['\200E']`}>
				{part}
			</span>
		) : (
			part
		),
	);
}

/** Private-use ranges upstream's `k` searches for a separator the text does not hold. */
const SEPARATOR_RANGES: readonly (readonly [number, number])[] = [
	[0xe000, 0xf8ff],
	[0xf0000, 0xffffd],
	[0x100000, 0x10fffd],
];

function unusedSeparator(text: string): string | undefined
{
	if (!text.includes("")) return "";
	const used = new Set(text);
	for (const [first, last] of SEPARATOR_RANGES)
		for (let code = first; code <= last; code++)
		{
			const char = String.fromCodePoint(code);
			if (!used.has(char)) return char;
		}
	return undefined;
}

/**
 * Upstream's `k` (cb557955f): the runs around each secret with `u9` applied to them as one text, so a
 * spoofing run split by a secret is still seen whole; null when no separator is free or the split drifts.
 */
function revealedRuns(text: string, secrets: readonly SecretMatch[]): string[] | null
{
	const runs: string[] = [];
	let cursor = 0;
	for (const secret of secrets)
	{
		runs.push(text.slice(cursor, secret.start));
		cursor = secret.end;
	}
	runs.push(text.slice(cursor));
	const separator = unusedSeparator(text);
	if (separator === undefined) return null;
	const revealed = revealSpoofing(runs.join(separator)).split(separator);
	return revealed.length === runs.length ? revealed : null;
}

/**
 * Upstream's cloak paint with `revealCloaks` (cb557955f `w`): text without a secret as `u9` of it, otherwise each
 * secret behind its own reveal button and the runs between shown through `u9`; line breaks drawn. With
 * `nonInteractive`, `u9` of the masked text, without buttons.
 */
export function CloakedText({text, nonInteractive = false}: {text: string; nonInteractive?: boolean})
{
	const secrets = findSecrets(text);
	if (secrets.length === 0) return <>{withBreaks(revealSpoofing(text), "t")}</>;
	if (nonInteractive)
		return <>{withBreaks(revealSpoofing(maskSecrets(text)), "t", pageIsRtl() ? markMaskedWords : undefined)}</>;
	const runs = revealedRuns(text, secrets);
	const nodes: ReactNode[] = [];
	let cursor = 0;
	secrets.forEach((secret, index) =>
	{
		const run = runs === null ? revealSpoofing(text.slice(cursor, secret.start)) : (runs[index] ?? "");
		if (run !== "") nodes.push(withBreaks(run, `p${cursor}`));
		nodes.push(<SecretCloak key={`s${secret.start}`} match={secret} />);
		cursor = secret.end;
	});
	const tail = runs === null ? revealSpoofing(text.slice(cursor)) : (runs[secrets.length] ?? "");
	if (tail !== "") nodes.push(withBreaks(tail, `p${cursor}`));
	return <>{nodes}</>;
}
