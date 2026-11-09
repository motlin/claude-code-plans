import type {ReactNode} from "react";

import {
	ENVIRONMENT_BAR_LINE_CLASS,
	ENVIRONMENT_BAR_LINE_HOST_CLASS,
	ENVIRONMENT_BAR_NOTE_CLASS,
} from "../composer-tokens";

/** Upstream's bar line value (`ma`): a blocking reason in danger ink, or a muted note. */
export interface EnvironmentBarLine {
	kind: "blocking" | "note";
	content: ReactNode;
}

/**
 * Upstream's environment-bar line in its zero-height host above the home composer card. The line is absolute
 * `bottom-1.5`, so it paints 6px above the card. A `line` wins; the custom-group `note` takes the line only when
 * there is none (upstream `zSe(ma)`), so callers pass the note only then.
 */
export function EnvironmentBarLineHost({line, note}: {line: EnvironmentBarLine | null; note: ReactNode}) {
	const shown = line !== null || (note !== null && note !== undefined && note !== false);
	return (
		<div data-environment-bar-line-host="" className={ENVIRONMENT_BAR_LINE_HOST_CLASS}>
			{shown && (
				<div
					data-testid="environment-bar-line"
					className={`${ENVIRONMENT_BAR_LINE_CLASS} ${line?.kind === "blocking" ? "text-danger" : "text-muted-as-secondary"}`}
				>
					{line === null ? (
						<div>
							<span className={ENVIRONMENT_BAR_NOTE_CLASS}>{note}</span>
						</div>
					) : (
						<div className="pointer-events-auto">{line.content}</div>
					)}
				</div>
			)}
		</div>
	);
}
