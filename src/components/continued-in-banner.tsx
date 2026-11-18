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
