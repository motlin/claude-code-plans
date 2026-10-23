import {PreviewCard} from "@base-ui/react/preview-card";
import {useContext} from "react";

import {SlashCommandsContext} from "./slash-commands-context";
import {UserPlainText} from "./user-plain-text";

const CHIP_CLASS =
	"group relative inline-flex items-baseline rounded-r5 text-upstream-accent cursor-pointer align-baseline";

const HIGHLIGHT_CLASS =
	"pointer-events-none absolute -inset-y-0.5 -start-0.5 -end-1 rounded-r5 opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-data-[popup-open]:opacity-100 bg-upstream-accent-pressed";

export const SLASH_COMMAND_CARD_CLASS =
	"flex w-[280px] max-w-[calc(100vw-16px)] flex-col gap-1 rounded-r7 bg-[var(--menu-bg)] p-3 text-[13px]/[19px] text-primary shadow-[var(--menu-shadow)] outline-none";

const CARD_DESCRIPTION_CLASS =
	"max-h-[min(40vh,calc(var(--available-height,100vh)-3rem))] overflow-y-auto overscroll-contain break-words text-primary";

/**
 * Upstream's shared hover-card content (`ln`): a muted `/name` line, then the description when
 * there is one. An unknown command (`description` undefined) gets a "No preview available" footnote.
 */
export function SlashCommandCardBody({name, description}: {name: string; description: string | undefined}) {
	if (description === undefined) {
		return <span className="text-[12px]/[16px] text-ink-muted">No preview available</span>;
	}
	return (
		<>
			<span data-slash-command-card-name="" className="truncate text-ink-muted">{`/${name}`}</span>
			{description !== "" && (
				<span data-slash-command-card-description="" className={CARD_DESCRIPTION_CLASS}>
					{description}
				</span>
			)}
		</>
	);
}

/**
 * Upstream's accent `/name` button: a 50% "/" glyph in a fixed slot, then the name. Hovering or
 * focusing it opens a hover card above; it has no click action.
 */
function SlashCommandChip({name}: {name: string}) {
	const commands = useContext(SlashCommandsContext);
	const description = commands.find((command) => command.name === name)?.description;

	return (
		<PreviewCard.Root>
			<PreviewCard.Trigger
				render={<button type="button" />}
				delay={400}
				data-slash-command-chip=""
				className={CHIP_CLASS}
			>
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
					<PreviewCard.Popup data-slash-command-card="" className={SLASH_COMMAND_CARD_CLASS}>
						<SlashCommandCardBody name={name} description={description} />
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
