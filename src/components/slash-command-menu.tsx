import {useLayoutEffect, useRef} from "react";

import {highlightMatches, isCustomCommand, matchingAlias, type SlashCommand} from "../lib/slash-commands";
import {slashCommandOptionId} from "./slash-command-option-id";
import {DENSITY_CLASSES} from "./ui/menu-internals";
import {TOOLTIP_CLASS} from "./ui/tooltip";
import {placeRowTooltip} from "./ui/tooltip-placement";

/* Upstream renders the slash popup in a compact-density portal whatever the account's density. */
const COMPACT = DENSITY_CLASSES.compact;

const POPUP_CLASS = `absolute bottom-full left-0 z-[130] mb-2 flex max-h-96 min-w-60 w-max max-w-[min(32rem,calc(100vw-16px))] flex-col ${COMPACT.popup} bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] select-none`;

const ROW_CLASS = `flex w-full cursor-pointer ${COMPACT.singleLine} gap-1.5 ${COMPACT.item} ${COMPACT.text} outline-none data-[highlighted]:bg-fill-ghost-hover`;

/* Upstream's shared tooltip box in the slash popup's z-130 positioner, fading and scaling over `duration-snap`. */
const ROW_TOOLTIP_CLASS = `${TOOLTIP_CLASS.replace("z-50", "z-[130]")} text-balance transition-[opacity,scale] duration-150 motion-reduce:transition-none`;

/* Labels bold in the row's ink; upstream's default highlight (the alias suffix) also lifts the match to primary. */
function Highlighted({
	text,
	query,
	highlightClassName = "font-semibold",
}: {
	text: string;
	query: string;
	highlightClassName?: string;
}) {
	return highlightMatches(text, query).map((segment, i) =>
		segment.match ? (
			<span key={i} className={highlightClassName}>
				{segment.text}
			</span>
		) : (
			segment.text
		),
	);
}

/**
 * The claude.ai/code "/" popup: a compact menu (240px to 32rem wide) above the composer with the
 * highlighted row's description as a dark tooltip 8px past that row. Keyboard focus
 * stays in the editor, which drives `highlighted` and `onAccept`.
 */
export function SlashCommandMenu({
	id,
	commands,
	query,
	highlighted,
	onHighlight,
	onAccept,
}: {
	id: string;
	commands: readonly SlashCommand[];
	query: string;
	highlighted: number;
	onHighlight: (index: number) => void;
	onAccept: (command: SlashCommand) => void;
}) {
	const popupRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const clampRef = useRef<HTMLSpanElement>(null);
	const active = commands[highlighted];

	/* Writes the tip's position straight to the DOM, like upstream's floating positioner, so following the row adds no React commit. */
	const placeTooltip = () => {
		const popup = popupRef.current;
		const row = scrollerRef.current?.querySelector<HTMLElement>("[data-highlighted]");
		const tooltip = tooltipRef.current;
		const clamp = clampRef.current;
		if (!popup || !row || !tooltip || !clamp) return;
		const placement = placeRowTooltip(row.getBoundingClientRect(), popup.getBoundingClientRect());
		tooltip.style.left = `${placement.left}px`;
		tooltip.style.top = `${placement.top}px`;
		clamp.style.maxWidth = placement.maxWidth;
	};

	useLayoutEffect(() => {
		scrollerRef.current?.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView({block: "nearest"});
		placeTooltip();
	}, [highlighted, commands]);

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- cancels mousedown so the composer textarea keeps focus
		<div
			ref={popupRef}
			className={POPUP_CLASS}
			onMouseDown={(e) => {
				e.preventDefault();
			}}
		>
			<div
				ref={scrollerRef}
				id={id}
				role="menu"
				aria-label="Slash commands"
				className="min-h-0 overflow-y-auto overflow-x-hidden rounded-[inherit] p-1"
				onScroll={placeTooltip}
			>
				{commands.map((command, index) => {
					const alias = matchingAlias(command, query);
					return (
						<div
							key={command.name}
							id={slashCommandOptionId(id, index)}
							role="menuitem"
							tabIndex={-1}
							data-highlighted={index === highlighted ? "" : undefined}
							className={ROW_CLASS}
							onMouseMove={() => {
								if (index !== highlighted) onHighlight(index);
							}}
							onMouseDown={(e) => {
								e.preventDefault();
								onAccept(command);
							}}
						>
							<span className="min-w-0 truncate">
								<Highlighted text={command.name} query={query} />
							</span>
							{alias !== undefined && (
								<span className="min-w-0 truncate text-ink-muted">
									<Highlighted
										text={`(${alias})`}
										query={query}
										highlightClassName="font-semibold text-primary"
									/>
								</span>
							)}
							{isCustomCommand(command.source) && (
								<span className="ml-auto shrink-0 pl-2 text-caption text-muted">Custom command</span>
							)}
						</div>
					);
				})}
			</div>
			{active !== undefined && active.description !== "" && (
				<div ref={tooltipRef} role="tooltip" className={ROW_TOOLTIP_CLASS}>
					<span className="min-w-0 break-words">
						<span ref={clampRef} className="line-clamp-[10]">
							<Highlighted text={active.description} query={query} />
						</span>
					</span>
				</div>
			)}
		</div>
	);
}
