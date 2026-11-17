import {TILE_REMOVE_CLASS} from "./attachment-tile-classes";
import {Icon} from "./ui/icon";

export interface AgentTileProps
{
	name: string;
	onRemove: () => void;
}

/**
 * Upstream's draft-strip agent tile (cc4a5adb7 `Xi{value:"agent"}`): the Agent glyph at xs, the agent's name and the
 * corner remove button. It has no preview, so nothing opens on hover.
 */
export function AgentTile({name, onRemove}: AgentTileProps)
{
	return (
		<li
			data-cds-attachment=""
			data-value="agent"
			data-chip-label={name}
			tabIndex={-1}
			className="group/tile relative isolate inline-flex h-8 max-w-[15rem] shrink-0 items-center gap-1.5 rounded-r7 bg-surface-3 px-2.5 text-footnote text-primary shadow-card-ring outline-none focus-visible:shadow-focus"
		>
			<Icon name="Agent" size="xs" className="text-secondary" />
			<span className="min-w-0 truncate">
				<bdi>{name}</bdi>
			</span>
			<button
				type="button"
				data-cds-attachment-remove=""
				aria-label={`Remove ${name}`}
				onClick={onRemove}
				className={TILE_REMOVE_CLASS}
			>
				<Icon name="X" customSize={12} />
			</button>
		</li>
	);
}
