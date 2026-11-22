import type {ProcessedLine} from "../lib/transcript";
import {Banner} from "./attachment-banner";
import {Icon} from "./ui/icon";

type ContinuedInLine = Extract<
	ProcessedLine,
	{
		type: "continued-in";
	}
>;

/** A `continued-in` record: the session this one was continued in, linked from the old transcript. */
export function ContinuedInBanner({line}: {line: ContinuedInLine})
{
	return (
		<Banner icon={<Icon name="ArrowRight" customSize={14} />}>
			<a
				href={`/session/${encodeURIComponent(line.continuedInSessionId)}`}
				title={line.continuedInSessionId}
				className="text-accent-100 hover:underline"
			>
				Continued in a new session
			</a>
		</Banner>
	);
}

type DerivedFromLine = Extract<
	ProcessedLine,
	{
		type: "derived-from";
	}
>;

/** How a `derived-from` record's `via` reads as a link. */
function derivedFromLabel(via: string): string
{
	if (via === "compact") return "Compacted from an earlier session";
	if (via === "resume") return "Resumed from an earlier session";
	return `Derived from an earlier session (${via})`;
}

/** A `derived-from` record: links to the sessions this one was compacted or resumed from. */
export function DerivedFromBanner({line}: {line: DerivedFromLine})
{
	return (
		<Banner icon={<Icon name="ArrowCounterClockwise" customSize={14} />}>
			<span className="flex flex-col">
				{line.sessions.map((session) => (
					<a
						key={session.id}
						href={`/session/${encodeURIComponent(session.id)}`}
						title={session.id}
						className="text-accent-100 hover:underline"
					>
						{derivedFromLabel(session.via)}
					</a>
				))}
			</span>
		</Banner>
	);
}
