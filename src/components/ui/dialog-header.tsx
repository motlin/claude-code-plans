import {Dialog} from "@base-ui/react/dialog";
import {X} from "lucide-react";
import type {ReactNode, Ref} from "react";

import {useFizzyLake} from "../../lib/fizzy-lake";
import {GHOST_ICON_BUTTON} from "./dialog-band";

/*
 * Upstream shared-frame `wf` (`jl` + sticky band) under panels, comfortable tokens resolved:
 * band 44px fine pointer / 48px coarse (`--cds-h-control` 28/32 + 2 × `--cds-toolbar-pad-block` 8),
 * bleed `--cds-band-bleed` = `--cds-pad-xl` 16px (`_z`), pe/py 8px, close 28/32px, bottom line
 * `--cds-toolbar-line` 1px in `--cds-border-line`. Only a tall window (`(min-height: 30rem)`, `An()`)
 * sticks the band at -16px and draws the line; with scroll-timeline support the line fades in over the
 * first 4px of scroll (`--cds-dialog-scroll`, here `--sc-dialog-scroll`), without it the line stays on.
 */
const BAND_CLASS = [
	"-mx-4 first:-mt-4 mb-1 flex shrink-0 items-center gap-1 self-stretch justify-self-stretch min-h-12 panels-fine:min-h-11 ps-4 pe-2 py-2",
	"sticky [:where([data-cds-tall-window])_&]:-top-4 z-[1000] bg-page",
	"after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 [:where([data-cds-tall-window])_&]:after:border-b after:border-[color:var(--color-border-line)]",
	"supports-[animation-timeline:scroll()]:after:opacity-0 supports-[animation-timeline:scroll()]:after:[animation-name:sc-sticky-edge]",
	"after:[animation-timing-function:linear] after:[animation-fill-mode:both] after:[animation-duration:auto] after:[animation-timeline:--sc-dialog-scroll] after:[animation-range:0px_4px]",
].join(" ");

/* Upstream `nf`: text-heading, semibold, the header family (15/20, 520 live); `last:me` 16 − 8 = 8px. */
const BAND_TITLE_CLASS =
	"pointer-events-auto min-w-0 flex-1 last:me-2 text-[15px]/[20px] font-[520] break-words text-primary";
/* Upstream `tU` (`Ud` + flex). */
const BAND_ACTIONS_CLASS = "pointer-events-auto self-start flex items-center";
/* Upstream `fA` with `Ud`: a ghost icon-only cds Button, `h-control` square. */
const BAND_CLOSE_CLASS = `${GHOST_ICON_BUTTON} pointer-events-auto self-start aspect-square size-8 panels-fine:size-7 rounded-r6`;
/* Upstream `y0`: margin-bottom `--cds-band-bleed` 16px. */
const BAND_DESCRIPTION_CLASS = "text-body font-normal text-secondary break-words mb-4";

/* Upstream flag-off JH: `mb-pad-md flex items-start gap-2`, title `text-title` 22/28, flush close. */
const OFF_HEADER_CLASS = "mb-3 flex items-start gap-2";
const OFF_TITLE_CLASS = "text-[22px]/[28px] font-[580] break-words text-primary";
const OFF_DESCRIPTION_CLASS = "text-body font-normal text-secondary break-words";
const OFF_CLOSE_CLASS = `-me-2 -mt-2 flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus`;

/**
 * Upstream cds `Dialog.Header` (`JH`): under panels the sticky `data-cds-part="band"` header (`aj`) with
 * the title, optional actions and the close, then the description; with panels off the flag-off header.
 * `band` forces the band whatever the panels flag (the shortcuts dialog, which upstream always shows so).
 */
export function DialogHeader({
	title,
	description,
	actions,
	showClose = true,
	closeLabel = "Close",
	closeRef,
	band,
	offHeaderClassName = OFF_HEADER_CLASS,
	offTitleClassName = OFF_TITLE_CLASS,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	showClose?: boolean;
	closeLabel?: string;
	closeRef?: Ref<HTMLButtonElement>;
	band?: boolean;
	offHeaderClassName?: string;
	offTitleClassName?: string;
})
{
	const panels = useFizzyLake("panels");
	const icon = <X aria-hidden="true" className="h-5 w-5" />;
	if (band ?? panels)
	{
		return (
			<>
				<div data-cds-part="band" className={BAND_CLASS}>
					<Dialog.Title className={BAND_TITLE_CLASS}>{title}</Dialog.Title>
					{actions === undefined ? null : <div className={BAND_ACTIONS_CLASS}>{actions}</div>}
					{showClose && (
						<Dialog.Close ref={closeRef} aria-label={closeLabel} className={BAND_CLOSE_CLASS}>
							{icon}
						</Dialog.Close>
					)}
				</div>
				{description === undefined ? null : (
					<Dialog.Description className={BAND_DESCRIPTION_CLASS}>{description}</Dialog.Description>
				)}
			</>
		);
	}
	return (
		<div className={offHeaderClassName}>
			<div className="-mt-1 flex min-w-0 flex-1 flex-col gap-1">
				<Dialog.Title className={offTitleClassName}>{title}</Dialog.Title>
				{description === undefined ? null : (
					<Dialog.Description className={OFF_DESCRIPTION_CLASS}>{description}</Dialog.Description>
				)}
			</div>
			{actions === undefined ? null : <div className="-mt-2 flex items-center">{actions}</div>}
			{showClose && (
				<Dialog.Close ref={closeRef} aria-label={closeLabel} className={OFF_CLOSE_CLASS}>
					{icon}
				</Dialog.Close>
			)}
		</div>
	);
}
