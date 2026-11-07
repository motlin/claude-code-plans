import {AlertDialog} from "@base-ui/react/alert-dialog";
import {memo, type ReactNode, useRef} from "react";
import {useFizzyLake} from "../lib/fizzy-lake";
import {DensityScope} from "./ui/density";
import {DIALOG_FOOTER_CLASS} from "./ui/dialog-pad";

const BUTTON_BASE_CLASS =
	"h-8 rounded-r6 px-3 text-body font-medium transition-colors hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

const CONFIRM_VARIANT_CLASS = {
	primary: "bg-fill-primary text-on-primary hover:bg-fill-primary-hover",
	danger: "bg-[var(--menu-danger-fill)] text-[var(--menu-on-danger)] hover:opacity-90",
} as const;

const POPUP_CLASS =
	"fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none";

/*
 * Upstream shared-frame ConfirmationDialog under fizzy-lake panels. Comfortable tokens:
 * pad-xl is pad-lg 16px (`_z`), band-bleed = pad-xl, toolbar-pad-block 8px, h-control 28px on a
 * fine pointer (32px otherwise), heading 15/21.
 * - `yB`: `${Xn} m-[var(--cds-ring-inner)] [--cds-band-bleed:var(--cds-pad-xl)]`, where `Xn` is
 *   `isolate flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y rounded-[inherit] p-xl break-words`.
 * - `sK` = `${jl} pointer-events-none`: `-mx-[band-bleed] first:-mt-[band-bleed] mb-1 flex shrink-0
 *   items-center gap-1 self-stretch justify-self-stretch min-h-[calc(h-control + 2 * toolbar-pad-block)]
 *   ps-[band-bleed] pe-[toolbar-pad-block] py-[toolbar-pad-block]`.
 * - `j5` = `${nf} py-[calc((h-control - 1lh) / 2)]`, `nf` = `pointer-events-auto min-w-0 flex-1
 *   last:me-[calc(band-bleed - toolbar-pad-block)] text-heading font-semibold (font header) break-words text-primary`.
 * - `jS` = `${Rf} -mt-[calc(toolbar-pad-block + (h-control - leading-heading) / 2)]`, `Rf` = `mx-0
 *   text-body font-normal text-secondary break-words`.
 */
const PANELS_BODY_CLASS =
	"isolate flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[inherit] p-4 break-words m-[var(--ring-inner)]";
const PANELS_BAND_CLASS =
	"-mx-4 first:-mt-4 mb-1 flex shrink-0 items-center gap-1 self-stretch justify-self-stretch min-h-12 panels-fine:min-h-11 ps-4 pe-2 py-2 pointer-events-none";
const PANELS_TITLE_CLASS =
	"pointer-events-auto min-w-0 flex-1 last:me-2 text-[15px]/[21px] font-semibold break-words text-primary py-[5.5px] panels-fine:py-[3.5px]";
const PANELS_DESCRIPTION_CLASS =
	"text-body font-normal text-secondary break-words -mt-[13.5px] panels-fine:-mt-[11.5px]";

/**
 * claude.ai/code's small confirm dialog: a title, one line of body copy, and
 * [Cancel] (initial focus) beside the confirm button, which is red for
 * destructive actions.
 */
export const ConfirmDialog = memo(function ConfirmDialog({
	open,
	onOpenChange,
	title,
	body,
	details,
	confirmLabel,
	cancelLabel = "Cancel",
	variant = "primary",
	onConfirm,
	onCancel,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	body?: ReactNode;
	/** Block content below the body, such as a list of affected items. */
	details?: ReactNode;
	confirmLabel: string;
	cancelLabel?: string;
	variant?: keyof typeof CONFIRM_VARIANT_CLASS;
	onConfirm: () => void;
	/** Runs only when the cancel button itself is clicked, not on Escape or a backdrop click. */
	onCancel?: () => void;
}) {
	const cancelRef = useRef<HTMLButtonElement>(null);
	const panels = useFizzyLake("panels");
	const rest = (
		<>
			{details !== undefined && <div className="mt-2 min-h-0 overflow-y-auto">{details}</div>}
			<div className={DIALOG_FOOTER_CLASS}>
				<AlertDialog.Close
					ref={cancelRef}
					type="button"
					onClick={onCancel}
					className={`${BUTTON_BASE_CLASS} border border-strong text-primary hover:bg-fill-ghost-hover`}
				>
					{cancelLabel}
				</AlertDialog.Close>
				<button
					type="button"
					onClick={() => {
						onConfirm();
						onOpenChange(false);
					}}
					className={`${BUTTON_BASE_CLASS} ${CONFIRM_VARIANT_CLASS[variant]}`}
				>
					{confirmLabel}
				</button>
			</div>
		</>
	);
	return (
		<AlertDialog.Root open={open} onOpenChange={onOpenChange}>
			<AlertDialog.Portal>
				<DensityScope density="comfortable">
					<AlertDialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
					<AlertDialog.Popup
						initialFocus={cancelRef}
						data-cds="ConfirmationDialog"
						data-cds-fizzy={panels ? "" : undefined}
						className={panels ? POPUP_CLASS : `${POPUP_CLASS} p-6`}
					>
						{panels ? (
							<div className={PANELS_BODY_CLASS}>
								<div data-cds-part="band" data-cds-alert="" className={PANELS_BAND_CLASS}>
									<AlertDialog.Title className={PANELS_TITLE_CLASS}>{title}</AlertDialog.Title>
								</div>
								{body !== undefined && (
									<AlertDialog.Description className={PANELS_DESCRIPTION_CLASS}>
										{body}
									</AlertDialog.Description>
								)}
								{rest}
							</div>
						) : (
							<>
								<AlertDialog.Title className="text-[17px] leading-6 font-semibold break-words text-primary">
									{title}
								</AlertDialog.Title>
								{body !== undefined && (
									<AlertDialog.Description className="mt-2 text-body break-words text-secondary">
										{body}
									</AlertDialog.Description>
								)}
								{rest}
							</>
						)}
					</AlertDialog.Popup>
				</DensityScope>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	);
});
