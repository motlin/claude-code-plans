import {
	ARTIFACT_MARK_KINDS,
	ARTIFACT_MARK_SIZES,
	artifactMarkClassName,
	type ArtifactMarkKind,
	type ArtifactMarkSize,
} from "../lib/artifact-mark";
import {Icon, type IconName} from "./ui/icon";
import {Spinner} from "./ui/spinner";

/*
 * The glyph's 1em box, pinned inline: upstream's glyph is a font character, so a host's `[&_svg]:size-*` rule
 * (the menu icon slot, the palette row) never resizes it; an inline size keeps the lucide svg the same.
 */
const GLYPH_BOX = {width: "1em", height: "1em"} as const;

/** Upstream's cds `Icon` at a mark glyph size, pinned to its 1em box; hidden unless labelled. */
export function ArtifactGlyph({
	icon,
	size,
	label,
	className,
}: {
	icon: IconName;
	size: "sm" | "md";
	label?: string | undefined;
	className?: string;
}) {
	return (
		<Icon
			name={icon}
			size={size}
			style={GLYPH_BOX}
			{...(className === undefined ? {} : {className})}
			{...(label === undefined ? {} : {alt: label})}
		/>
	);
}

/**
 * Upstream's shared `ArtifactMark` (`n8`): `span[data-artifact-mark][data-artifact-mark-size]` holding the kind's
 * outline glyph, as a tinted tile (card 40px, row 28px) or a bare tinted glyph (menu 20px, menu-small 16px).
 * `busy` swaps the glyph for the md spinner in the mark's own ink; `glyph` is a file mark's declared glyph.
 */
export function ArtifactMark({
	kind,
	size = "row",
	label,
	busy = false,
	glyph,
}: {
	kind: ArtifactMarkKind;
	size?: ArtifactMarkSize;
	label?: string;
	busy?: boolean;
	glyph?: IconName | undefined;
}) {
	return (
		<span data-artifact-mark={kind} data-artifact-mark-size={size} className={artifactMarkClassName(kind, size)}>
			{busy ? (
				<Spinner size="md" tone="current" />
			) : (
				<ArtifactGlyph
					icon={(kind === "file" ? glyph : undefined) ?? ARTIFACT_MARK_KINDS[kind].icon}
					size={ARTIFACT_MARK_SIZES[size].glyph}
					label={label}
				/>
			)}
		</span>
	);
}
