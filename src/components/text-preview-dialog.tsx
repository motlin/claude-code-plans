import {Dialog} from "@base-ui/react/dialog";
import {useRef} from "react";

import {TEXT_PREVIEW_LIMIT, textPreviewStats} from "../lib/text-preview";
import {useFizzyLake} from "../lib/fizzy-lake";
import {DensityScope} from "./ui/density";
import {useDialogBandBodyClass} from "./ui/dialog-band";
import {DialogHeader} from "./ui/dialog-header";
import {useDialogPad} from "./ui/dialog-pad";
import {DialogPopup} from "./ui/dialog-popup";
import {DIALOG_BODY_CLASS} from "./ui/dialog-classes";

/**
 * A port of upstream's FilePreviewModal text paths: an `excerpt` shows the
 * text as a blockquote, a `file` as a code box under its size line.
 */
export function TextPreviewDialog({
	open,
	title,
	text,
	variant,
	size,
	onClose,
	finalFocus,
}: {
	open: boolean;
	title: string;
	text: string;
	variant: "excerpt" | "file";
	/** The whole file's byte size when `text` is a read of it; defaults to the text's own. */
	size?: number | undefined;
	onClose: () => void;
	/** Where focus returns on close; defaults to Base UI's previously focused element. */
	finalFocus?: () => HTMLElement | boolean;
})
{
	const closeRef = useRef<HTMLButtonElement>(null);
	const shown = text.slice(0, TEXT_PREVIEW_LIMIT);
	const {size: sizeLabel, lines} = textPreviewStats(shown, size);
	const panels = useFizzyLake("panels");
	const pad = useDialogPad();
	const bandBody = useDialogBandBodyClass();
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) =>
			{
				if (!next) onClose();
			}}
		>
			<Dialog.Portal>
				<div className="pointer-events-auto relative z-[140]">
					<DensityScope density="comfortable">
						<Dialog.Backdrop className="fixed inset-0 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
						<DialogPopup
							initialFocus={closeRef}
							{...(finalFocus === undefined
								? {}
								:
									{
										finalFocus,
									})}
							className="fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body font-normal text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
						>
							<div className={`${DIALOG_BODY_CLASS} ${pad.p} ${bandBody}`}>
								<DialogHeader
									title={title}
									closeRef={closeRef}
									{...(variant === "file"
										?
											{
												description: (
													<span
														className={`${panels ? "" : "mb-3 mt-0.5 "}flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs`}
													>
														<span>
															<span>{sizeLabel}&nbsp;</span>
															<span className="mx-1 opacity-50">•</span>
															{lines} lines
														</span>
														<span className="hidden opacity-50 lg:inline">•</span>
														<span>Formatting may be inconsistent from source</span>
													</span>
												),
											}
										: {})}
								/>
								{variant === "file" ? (
									<div
										dir="auto"
										className="overflow-auto whitespace-pre-wrap rounded-card bg-surface-1 p-3 text-code text-primary shadow-card-ring break-all max-h-[70vh]"
									>
										{shown}
									</div>
								) : (
									<div className="mt-3">
										<blockquote className="ms-0 whitespace-pre-wrap border-s-4 border-border ps-[14px] text-secondary">
											{shown}
										</blockquote>
									</div>
								)}
							</div>
						</DialogPopup>
					</DensityScope>
				</div>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
