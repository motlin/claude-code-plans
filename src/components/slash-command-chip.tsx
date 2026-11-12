import {PreviewCard} from "@base-ui/react/preview-card";
import {useContext} from "react";

import {useFizzyLake} from "../lib/fizzy-lake";
import {SLASH_COMMAND_CARD_CLASS, SlashCommandCardBody} from "./slash-command-card";
import {SlashCommandsContext} from "./slash-commands-context";
import {UserPlainText} from "./user-plain-text";

const CHIP_CLASS =
	"group relative inline-flex items-baseline rounded-r5 text-upstream-accent cursor-pointer align-baseline";

const HIGHLIGHT_BASE_CLASS = "pointer-events-none absolute -inset-y-0.5 -start-0.5 -end-1 rounded-r5";

/*
 * Upstream `dn`'s highlight. Under fizzy-lake `color` (its `stacks:` variants) the hover is the
 * translucent 6% `bg-accent-layer`, the open card's 12% `bg-accent`, and both stacked (as a
 * gradient) while the open chip is still hovered.
 */
const HIGHLIGHT_CLASS =
{
	fizzy: `${HIGHLIGHT_BASE_CLASS} [@media(hover:hover)]:group-hover:bg-upstream-accent-layer group-data-[popup-open]:bg-upstream-accent-pressed [@media(hover:hover)]:group-data-[popup-open]:group-hover:bg-[linear-gradient(var(--upstream-accent-layer),var(--upstream-accent-layer))]`,
	base: `${HIGHLIGHT_BASE_CLASS} opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-data-[popup-open]:opacity-100 bg-upstream-accent-pressed`,
};

/**
 * Upstream's accent `/name` button: a 50% "/" glyph in a fixed slot, then the name. Hovering or
 * focusing it opens a hover card above; it has no click action.
 */
function SlashCommandChip({name}: {name: string})
{
	const commands = useContext(SlashCommandsContext);
	const description = commands.find((command) => command.name === name)?.description;
	const look = useFizzyLake("color") ? "fizzy" : "base";

	return (
		<PreviewCard.Root>
			<PreviewCard.Trigger
				render={<button type="button" />}
				delay={400}
				data-slash-command-chip=""
				className={CHIP_CLASS}
			>
				<span aria-hidden="true" data-slash-command-highlight="" className={HIGHLIGHT_CLASS[look]} />
				<span
					aria-hidden="true"
					data-slash-command-slash=""
					className="relative inline-block w-2 text-[13px] font-control opacity-50"
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
export function SlashCommandText({name, rest}: {name: string; rest: string})
{
	return <UserPlainText text={rest} prefix={<SlashCommandChip name={name} />} />;
}
