import {Popover} from "@base-ui/react/popover";
import {createContext, useContext} from "react";

import type {SlashCommand} from "../lib/slash-commands";
import {MarkdownArticle} from "./markdown-article";

const EMPTY_SLASH_COMMANDS: readonly SlashCommand[] = [];

/** The commands `/api/commands` knows for this session's project, for the chip's description. */
export const SlashCommandsContext = createContext<readonly SlashCommand[]>(EMPTY_SLASH_COMMANDS);

const CHIP_CLASS =
	"inline-flex items-baseline rounded-md text-accent-000 hover:bg-accent-900 cursor-pointer align-baseline";

const POPUP_CLASS =
	"flex w-[300px] max-w-[calc(100vw-16px)] flex-col gap-1 rounded-card bg-[var(--menu-bg)] px-3 py-2 text-[13px]/[18px] text-primary shadow-[var(--menu-shadow)] outline-none";

/** Upstream's accent `/name` button: a 50% "/" glyph in a fixed slot, then the name. */
function SlashCommandChip({name}: {name: string}) {
	const commands = useContext(SlashCommandsContext);
	const description = commands.find((command) => command.name === name)?.description ?? "";

	return (
		<Popover.Root>
			<Popover.Trigger data-slash-command-chip="" className={CHIP_CLASS}>
				<span aria-hidden="true" className="inline-block w-2 opacity-50">
					/
				</span>
				<span data-slash-command-label="" className="pl-2 pr-0.5">
					{name}
				</span>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner side="top" align="start" sideOffset={6} className="z-[130]">
					<Popover.Popup data-testid="slash-command-popover" className={POPUP_CLASS}>
						<Popover.Title data-slash-command-popover-name="" className="text-secondary">
							{`/${name}`}
						</Popover.Title>
						{description !== "" && (
							<Popover.Description data-slash-command-popover-description="" className="text-primary">
								{description}
							</Popover.Description>
						)}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

/**
 * A user prompt that opens with a slash command: the chip, then the rest of the prompt flowing
 * on the same line, as upstream shows it.
 */
export function SlashCommandText({name, rest}: {name: string; rest: string}) {
	return (
		<div className="[&>article]:inline [&>article>*:first-child]:inline">
			<SlashCommandChip name={name} />
			{rest !== "" && (
				<>
					{" "}
					<MarkdownArticle markdown={rest} />
				</>
			)}
		</div>
	);
}
