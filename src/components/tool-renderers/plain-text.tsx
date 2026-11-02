import {Fragment, type ReactElement, type ReactNode} from "react";

import {ansiPartStyle, parseAnsiCodes} from "../../lib/ansi-codes";
import {findSecrets, maskSecrets, type SecretMatch} from "../../lib/secret-mask";
import {SecretCloak} from "../secret-cloak";

type AnsiPart = ReturnType<typeof parseAnsiCodes>[number];

/** Upstream c5071af19 `Kn`: past this many characters a body's secrets are masked in place, not cloaked. */
const CLOAK_LIMIT = 262_144;

/** Upstream `_e`: the text carries ANSI escape sequences to paint. */
const ANSI_ESCAPE = "\u001b[";

function styled(part: AnsiPart, text: string, key: string): ReactElement
{
	return (
		<span key={key} style={ansiPartStyle(part)}>
			{text}
		</span>
	);
}

/** Upstream cb557955f `a` (`x`): plain runs through `renderPlain`, each secret as a cloak. */
function cloakPlain(
	text: string,
	secrets: readonly SecretMatch[],
	renderPlain: (text: string) => ReactNode,
): ReactNode[]
{
	if (secrets.length === 0) return [<Fragment key="p0">{renderPlain(text)}</Fragment>];
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const secret of secrets)
	{
		if (secret.start > cursor)
			nodes.push(<Fragment key={`p${cursor}`}>{renderPlain(text.slice(cursor, secret.start))}</Fragment>);
		nodes.push(<SecretCloak key={`s${secret.start}`} match={secret} />);
		cursor = secret.end;
	}
	if (cursor < text.length) nodes.push(<Fragment key={`p${cursor}`}>{renderPlain(text.slice(cursor))}</Fragment>);
	return nodes;
}

/** Upstream cb557955f `i` (`C`): styled ANSI runs, cut around each secret's cloak. */
function cloakAnsi(parts: readonly AnsiPart[], secrets: readonly SecretMatch[]): ReactNode[]
{
	const nodes: ReactNode[] = [];
	const push = (part: AnsiPart, text: string, at: number) =>
	{
		if (text !== "") nodes.push(styled(part, text, `t${at}`));
	};
	let runStart = 0;
	let next = 0;
	let resumeAt = 0;
	for (const part of parts)
	{
		const runEnd = runStart + part.text.length;
		let from = Math.max(runStart, resumeAt);
		for (let secret = secrets[next]; secret !== undefined && secret.start < runEnd; secret = secrets[next])
		{
			push(part, part.text.slice(from - runStart, secret.start - runStart), from);
			nodes.push(<SecretCloak key={`s${secret.start}`} match={secret} />);
			resumeAt = secret.end;
			from = Math.min(secret.end, runEnd);
			next++;
			if (secret.end > runEnd) break;
		}
		if (from < runEnd) push(part, part.text.slice(from - runStart), from);
		runStart = runEnd;
	}
	return nodes;
}

function identity(text: string): ReactNode
{
	return text;
}

/**
 * Upstream c5071af19 `Kn` (the transcript's plain text, `H`): ANSI SGR runs painted, every secret cloaked
 * behind its own reveal button, and plain (non-ANSI) runs handed to `renderPlain`, which tool bodies use to
 * link URLs. A body longer than 256 KiB holding a secret is masked in place instead.
 */
export function PlainText({
	children: text,
	renderPlain = identity,
}: {
	children: string;
	renderPlain?: (text: string) => ReactNode;
})
{
	const parts = text.includes(ANSI_ESCAPE) ? parseAnsiCodes(text) : null;
	const plain = parts === null ? text : parts.map((part) => part.text).join("");
	if (plain.length > CLOAK_LIMIT)
	{
		const masked = maskSecrets(plain);
		if (masked !== plain)
		{
			if (parts === null) return <>{renderPlain(masked)}</>;
			let cursor = 0;
			return (
				<>
					{parts.map((part, index) =>
					{
						const slice = masked.slice(cursor, cursor + part.text.length);
						cursor += part.text.length;
						return styled(part, slice, `t${index}`);
					})}
				</>
			);
		}
	}
	const secrets = findSecrets(plain);
	return <>{parts === null ? cloakPlain(text, secrets, renderPlain) : cloakAnsi(parts, secrets)}</>;
}
