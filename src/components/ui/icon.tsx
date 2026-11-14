/*
 * Upstream's cds `Icon` (shared-frame `BO`), drawn with lucide glyphs through its customIcon svg form.
 *
 * Copied: the API (`name`, `size` xs…xxl | auto | auto-sm | auto-lg, `customSize`, `bold`, `rotate`, `alt`),
 * the size and stroke table, density-driven `auto`, the DOM hooks (`data-cds="Icon"`, `data-cds-mirror`,
 * `data-cds-rotate` + `--cds-icon-rotate`), the 1em box with a rem font-size, and the DotsVertical alias.
 * Upstream's variable `wght` encodes a stroke width in px; scaling it by the 24-unit lucide viewBox over the
 * rendered px reproduces it exactly.
 *
 * Not copied: the Anthropicons-Variable font itself, its two-tone secondary layer, the `opsz` axis and the
 * block-display font readiness telemetry. The font has no redistribution license (its `name` table carries
 * no copyright or license records, re-checked 2026-11-05) and this repo is public, so the glyph drawings are
 * lucide's. Lucide also prepends its own `lucide lucide-*` classes to the caller's className.
 */
import type {ReactElement, SVGAttributes} from "react";

import {FILLED_GLYPHS, ICON_GLYPHS, ICON_MIRRORED} from "../../lib/icon-glyphs";
import
{
	ICON_SIZE_TABLE,
	ICON_SLOT_CLASS,
	ICON_SLOT_FIRST_LINE_CLASS,
	type IconSizeProp,
	iconFontSize,
	nearestIconSize,
	resolveIconSize,
} from "../../lib/icon-sizes";
import {useDensity} from "./density-context";

type GlyphName = keyof typeof ICON_GLYPHS | keyof typeof FILLED_GLYPHS;
export type IconName = GlyphName | "DotsVertical";

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "name" | "rotate" | "children">
{
	name: IconName;
	size?: IconSizeProp;
	/** A px size off the table; the stroke follows the nearest table size. */
	customSize?: number;
	bold?: boolean;
	/** Degrees; flipped under RTL by the cds rotate rule. */
	rotate?: number;
	/** Makes the icon meaningful: `role="img"` with this label instead of `aria-hidden`. */
	alt?: string;
}

const GLYPHS: Record<
	GlyphName,
	(typeof ICON_GLYPHS)[keyof typeof ICON_GLYPHS] | (typeof FILLED_GLYPHS)[keyof typeof FILLED_GLYPHS]
> =
{
	...ICON_GLYPHS,
	...FILLED_GLYPHS,
};

/** Lucide draws every glyph in a 24-unit viewBox, so a px stroke scales by 24 / rendered px. */
const LUCIDE_VIEWBOX = 24;

export function Icon({name, size, customSize, bold = false, rotate, alt, className, style, ...rest}: IconProps)
{
	const density = useDensity();
	const glyphName: GlyphName = name === "DotsVertical" ? "DotsHorizontal" : name;
	const tableSize = customSize === undefined ? resolveIconSize(size, density) : nearestIconSize(customSize);
	const spec = ICON_SIZE_TABLE[tableSize];
	const px = customSize ?? spec.px;
	const stroke = bold && spec.strong !== undefined ? spec.strong : spec.stroke;
	const rotated = rotate !== undefined && rotate !== 0;
	const Glyph = GLYPHS[glyphName];
	return (
		<Glyph
			size={px}
			strokeWidth={(stroke * LUCIDE_VIEWBOX) / px}
			width="1em"
			height="1em"
			data-cds="Icon"
			data-cds-mirror={ICON_MIRRORED.has(glyphName) ? "" : undefined}
			data-cds-rotate={rotated ? "" : undefined}
			style={
			{
				flexShrink: 0,
				fontSize: iconFontSize(px),
				...(rotated &&
				{
					"--cds-icon-rotate": `${rotate}deg`,
				}),
				...style,
			}}
			{...(className !== undefined &&
			{
				className,
			})}
			{...rest}
			role={alt === undefined ? undefined : "img"}
			aria-hidden={alt === undefined ? "true" : undefined}
			aria-label={alt}
		/>
	);
}

/** Upstream's `nd` leading slot: an `auto` Icon in the `size-icon` box, or with `firstLine` a `w-icon` box pinned to the first line. */
export function IconSlot({icon, firstLine = false}: {icon: IconName | ReactElement; firstLine?: boolean})
{
	return (
		<span className={firstLine ? ICON_SLOT_FIRST_LINE_CLASS : ICON_SLOT_CLASS}>
			{typeof icon === "string" ? <Icon name={icon} size="auto" /> : icon}
		</span>
	);
}
