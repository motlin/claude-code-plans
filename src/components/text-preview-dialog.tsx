import {Dialog} from "@base-ui/react/dialog";
import {X} from "lucide-react";
import {useRef} from "react";

import {TEXT_PREVIEW_LIMIT, textPreviewStats} from "../lib/text-preview";
import {DensityScope} from "./ui/density";

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
}) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const shown = text.slice(0, TEXT_PREVIEW_LIMIT);
	const {size: sizeLabel, lines} = textPreviewStats(shown, size);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<Dialog.Portal>
				<div className="pointer-events-auto relative z-[140]">
					<DensityScope density="comfortable">
						<Dialog.Backdrop className="fixed inset-0 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
						<Dialog.Popup
							initialFocus={closeRef}
							{...(finalFocus === undefined ? {} : {finalFocus})}
							data-cds="Dialog"
							className="fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body font-normal text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
						>
							<div className="isolate flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[inherit] p-6 break-words">
								<div className="mb-3 flex items-start gap-2">
									<div className="-mt-1 flex min-w-0 flex-1 flex-col gap-1">
										<Dialog.Title className="text-[22px]/[28px] font-[580] break-words text-primary">
											{title}
										</Dialog.Title>
										{variant === "file" ? (
											<Dialog.Description className="text-body font-normal text-secondary break-words">
												<span className="mb-3 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs">
													<span>
														<span>{sizeLabel}&nbsp;</span>
														<span className="mx-1 opacity-50">•</span>
														{lines} lines
													</span>
													<span className="hidden opacity-50 lg:inline">•</span>
													<span>Formatting may be inconsistent from source</span>
												</span>
											</Dialog.Description>
										) : null}
									</div>
									<Dialog.Close
										ref={closeRef}
										aria-label="Close"
										className="-me-2 -mt-2 flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
									>
										<X aria-hidden="true" className="h-5 w-5" />
									</Dialog.Close>
								</div>
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
						</Dialog.Popup>
					</DensityScope>
				</div>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
