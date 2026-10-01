import {PreviewCard} from "@base-ui/react/preview-card";
import {createContext, useContext} from "react";

import type {SlashCommand} from "../lib/slash-commands";
import {UserPlainText} from "./user-plain-text";

const EMPTY_SLASH_COMMANDS: readonly SlashCommand[] = [];

/** The commands `/api/commands` knows for this session's project, for the chip's description. */
export const SlashCommandsContext = createContext<readonly SlashCommand[]>(EMPTY_SLASH_COMMANDS);

const CHIP_CLASS =
	"group relative inline-flex items-baseline rounded-r5 text-upstream-accent cursor-pointer align-baseline";

const HIGHLIGHT_CLASS =
	"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 bg-upstream-accent-muted opacity-0 group-hover:opacity-100";

const CARD_CLASS =
	"flex w-[280px] max-w-[calc(100vw-16px)] flex-col gap-1 rounded-r7 bg-[var(--menu-bg)] p-3 text-[13px]/[19px] text-primary shadow-[var(--menu-shadow)] outline-none";

/**
 * Upstream's accent `/name` button: a 50% "/" glyph in a fixed slot, then the name. Hovering or
 * focusing it opens a hover card above; it has no click action.
 */
function SlashCommandChip({name}: {name: string}) {
	const commands = useContext(SlashCommandsContext);
	const description = commands.find((command) => command.name === name)?.description ?? "";

	return (
		<PreviewCard.Root>
			<PreviewCard.Trigger render={<button type="button" />} data-slash-command-chip="" className={CHIP_CLASS}>
				<span aria-hidden="true" data-slash-command-highlight="" className={HIGHLIGHT_CLASS} />
				<span
					aria-hidden="true"
					data-slash-command-slash=""
					className="relative inline-block w-2 text-[13px] font-medium opacity-50"
				>
					/
				</span>
				<span data-slash-command-label="" className="relative pl-2 pr-0.5">
					{name}
				</span>
			</PreviewCard.Trigger>
			<PreviewCard.Portal>
				<PreviewCard.Positioner side="top" align="start" sideOffset={6} className="z-[130]">
					<PreviewCard.Popup data-slash-command-card="" className={CARD_CLASS}>
						<div data-slash-command-card-name="" className="text-secondary">{`/${name}`}</div>
						{description !== "" && <div data-slash-command-card-description="">{description}</div>}
					</PreviewCard.Popup>
				</PreviewCard.Positioner>
			</PreviewCard.Portal>
		</PreviewCard.Root>
	);
}

/**
 * A user prompt that opens with a slash command: the chip, then the rest of the prompt flowing
 * on the same line, as upstream shows it.
 */
export function SlashCommandText({name, rest}: {name: string; rest: string}) {
	return <UserPlainText text={rest} prefix={<SlashCommandChip name={name} />} />;
}
