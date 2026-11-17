import {Checkbox} from "@base-ui/react/checkbox";
import type {ReactNode} from "react";

import {Icon} from "./icon";

/**
 * Upstream's cds Checkbox (shared-frame `fP`) with a label: Base UI's root as a button carrying the label, a
 * box sized by --cds-checkbox, and a Check glyph that is always drawn and clipped away while unchecked (no
 * `animated`, so no clip-path transition). Upstream's edge var chain is local's `checkbox-edge` colors.
 */
const ROOT_CLASS =
	"cds-reset group/cb border-0 outline-none focus-visible:outline-hidden data-[disabled]:opacity-disabled inline-flex gap-xs text-start font-sans text-body font-normal text-primary items-start";

const BOX_CLASS =
	"flex shrink-0 size-[var(--cds-checkbox)] items-center justify-center rounded-[var(--cds-checkbox-radius)] border border-checkbox-edge bg-transparent group-data-[unchecked]/cb:group-hover/cb:border-checkbox-edge-hover group-data-[checked]/cb:bg-fill-accent group-data-[checked]/cb:border-transparent group-data-[checked]/cb:group-hover/cb:bg-fill-accent-hover group-data-[disabled]/cb:group-data-[unchecked]/cb:group-hover/cb:border-checkbox-edge group-focus-visible/cb:shadow-focus mt-[calc((1lh_-_var(--cds-checkbox,1rem))_/_2)]";

const GLYPH_CLASS =
	"text-on-accent [clip-path:inset(0_100%_0_0)] group-data-[checked]/cb:[clip-path:inset(0)] group-data-[indeterminate]/cb:[clip-path:inset(0)]";

const GLYPH_STYLE =
{
	fontSize: "var(--cds-checkbox-glyph)",
};

export interface CdsCheckboxProps
{
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	label: ReactNode;
	size?: "xs" | "xxs";
	disabled?: boolean;
	"aria-describedby"?: string;
}

export function CdsCheckbox({
	checked,
	onCheckedChange,
	label,
	size,
	disabled = false,
	"aria-describedby": describedBy,
}: CdsCheckboxProps)
{
	return (
		<Checkbox.Root
			checked={checked}
			onCheckedChange={(next) =>
			{
				onCheckedChange(next);
			}}
			disabled={disabled}
			nativeButton
			render={<button type="button" />}
			data-cds="Checkbox"
			{...(size !== undefined &&
			{
				"data-size": size,
			})}
			{...(describedBy !== undefined &&
			{
				"aria-describedby": describedBy,
			})}
			className={ROOT_CLASS}
		>
			<span className={BOX_CLASS}>
				<span className={GLYPH_CLASS}>
					<Icon name="Check" size="sm" bold style={GLYPH_STYLE} />
				</span>
			</span>
			<span>{label}</span>
		</Checkbox.Root>
	);
}
