import {PreviewCard} from "@base-ui/react/preview-card";
import {type MouseEvent, useLayoutEffect, useRef, useState} from "react";

import {useFizzyLake} from "../lib/fizzy-lake";
import {SLASH_COMMAND_CARD_CLASS, SlashCommandCardBody} from "./slash-command-chip";

/** Upstream `pn`'s trigger; the only part of the pointer-transparent overlay that takes the mouse. */
const TRIGGER_CLASS = "inline-flex relative pointer-events-auto";

const CHIP_CLASS = "group/chip inline-flex relative cursor-interactive text-upstream-accent";

const HIGHLIGHT_BASE_CLASS = "absolute -inset-y-0.5 -start-0.5 -end-1 rounded-r5 pointer-events-none";

/*
 * Upstream `jr` swaps the highlight's classes to `bg-accent` while the atom is the NodeSelection.
 * Under fizzy-lake `color` (upstream's `stacks:` variants) the hover is the translucent
 * 6% `bg-accent-layer`, which also stacks (as a gradient) over an open or selected chip's 12% `bg-accent`.
 */
const HIGHLIGHT_CLASS =
{
	fizzy: `${HIGHLIGHT_BASE_CLASS} [@media(hover:hover)]:group-hover/chip:bg-upstream-accent-layer group-data-[card-open]/chip:bg-upstream-accent-pressed [@media(hover:hover)]:group-data-[card-open]/chip:group-hover/chip:bg-[linear-gradient(var(--upstream-accent-layer),var(--upstream-accent-layer))]`,
	base: `${HIGHLIGHT_BASE_CLASS} group-hover/chip:[@media(hover:hover)]:bg-upstream-accent-pressed group-data-[card-open]/chip:bg-upstream-accent-pressed`,
};

const HIGHLIGHT_SELECTED_CLASS =
{
	fizzy: `${HIGHLIGHT_BASE_CLASS} bg-upstream-accent-pressed [@media(hover:hover)]:group-hover/chip:bg-[linear-gradient(var(--upstream-accent-layer),var(--upstream-accent-layer))]`,
	base: `${HIGHLIGHT_BASE_CLASS} bg-upstream-accent-pressed`,
};

const GLYPH_CLASS =
	"absolute top-1/2 -translate-y-1/2 start-0 w-2 h-5 flex items-center justify-center text-[13px]/[19px] font-control opacity-50 select-none";

/**
 * Upstream's composer `skillChip` node view (`Cq`), painted in the composer's mirror overlay over
 * the transparent textarea text `/name`. The chip's 8px "/" slot is wider than the textarea's "/"
 * glyph, so a start margin gives back the difference: the text after the chip stays under the caret,
 * and the space after the chip stays visible. Hovering it opens upstream's composer hover card
 * (`pn`, 300ms); pressing it hands the caret back to the textarea, after the chip.
 */
export function ComposerSkillChip({
	name,
	description,
	selected,
	onPress,
}: {
	name: string;
	description: string | undefined;
	selected: boolean;
	onPress: (event: MouseEvent<HTMLSpanElement>) => void;
})
{
	const [cardOpen, setCardOpen] = useState(false);
	const look = useFizzyLake("color") ? "fizzy" : "base";
	const chipRef = useRef<HTMLSpanElement>(null);
	const plainRef = useRef<HTMLSpanElement>(null);
	const [offset, setOffset] = useState(0);

	useLayoutEffect(() =>
	{
		const measure = () =>
		{
			const chip = chipRef.current;
			const plain = plainRef.current;
			if (chip === null || plain === null) return;
			setOffset(plain.getBoundingClientRect().width - chip.getBoundingClientRect().width);
		};
		measure();
		// Re-measure when the plain text's width changes: web fonts loading, the coarse-pointer 16px floor.
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
		if (plainRef.current !== null) observer?.observe(plainRef.current);
		return () =>
		{
			observer?.disconnect();
		};
	}, [name]);

	return (
		<>
			<span
				ref={chipRef}
				data-testid="composer-skill-chip"
				data-skill-id={name}
				dir="auto"
				className={CHIP_CLASS}
				data-card-open={cardOpen ? "true" : undefined}
				style={
					offset === 0
						? undefined
						:
							{
								marginInlineStart: `${offset}px`,
							}
				}
			>
				<PreviewCard.Root onOpenChange={setCardOpen}>
					<PreviewCard.Trigger render={<span />} delay={300} className={TRIGGER_CLASS} onMouseDown={onPress}>
						<span className={selected ? HIGHLIGHT_SELECTED_CLASS[look] : HIGHLIGHT_CLASS[look]} />
						<span className="relative ps-2">
							<span aria-hidden="true" className={GLYPH_CLASS}>
								/
							</span>
							<span className="select-none">{name}</span>
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
			</span>
			<span ref={plainRef} data-skill-chip-measure="" className="invisible absolute whitespace-pre">
				{`/${name}`}
			</span>
		</>
	);
}
