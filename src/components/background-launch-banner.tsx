import type {MouseEvent} from "react";
import type {ProcessedLine} from "../lib/transcript";
import {Banner} from "./attachment-banner";
import {useSubagentOpener} from "./subagent-opener-context";
import {Icon} from "./ui/icon";

type BackgroundLaunchLine = Extract<
	ProcessedLine,
	{
		type: "background-launch";
	}
>;

/**
 * An `informational` "Started in the background: …" record: names the agent it launched and links to its
 * transcript, opening it in the Subagent pane on a plain click where the page hosts one.
 */
export function BackgroundLaunchBanner({line}: {line: BackgroundLaunchLine})
{
	const openSubagent = useSubagentOpener();
	const onClick =
		openSubagent === null
			? undefined
			: (event: MouseEvent<HTMLAnchorElement>) =>
				{
					if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
					event.preventDefault();
					openSubagent(line.agentId);
				};
	return (
		<Banner icon={<Icon name="Agent" customSize={14} />}>
			<span className="min-w-0 truncate">
				Started in the background:{" "}
				<a
					href={`/session/${encodeURIComponent(line.agentId)}`}
					title={line.agentId}
					onClick={onClick}
					className="text-accent-100 hover:underline"
				>
					{line.description}
				</a>
			</span>
		</Banner>
	);
}
