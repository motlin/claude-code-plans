import {Dialog} from "@base-ui/react/dialog";
import {ChevronLeft, ChevronRight, X} from "lucide-react";
import type {KeyboardEvent} from "react";

import type {AttachedImage} from "./user-attachments";

const VIEWER_BUTTON =
	"flex shrink-0 cursor-pointer items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white";

/**
 * Upstream's full-screen image viewer: the image at up to 70vh on a black/80
 * backdrop, Close at the top right, and Previous / Next around "N of M".
 */
export function ImageViewer({
	images,
	index,
	onIndexChange,
	onClose,
}: {
	images: readonly AttachedImage[];
	index: number;
	onIndexChange: (index: number) => void;
	onClose: () => void;
}) {
	const image = images[index];
	const step = (delta: number) => {
		onIndexChange((index + delta + images.length) % images.length);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "ArrowLeft") step(-1);
		if (event.key === "ArrowRight") step(1);
	};
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Popup
					aria-label="Image viewer"
					onKeyDown={onKeyDown}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 outline-none"
				>
					<div className="absolute inset-x-0 top-0 z-20 flex items-center justify-end gap-1.5 p-4">
						<Dialog.Close aria-label="Close" className={`${VIEWER_BUTTON} size-8`}>
							<X aria-hidden="true" className="size-5" />
						</Dialog.Close>
					</div>
					{image !== undefined && (
						<img
							src={image.src}
							alt={image.label}
							referrerPolicy="no-referrer"
							className="h-auto max-h-[70vh] w-auto max-w-[75vw] rounded-2xl object-contain"
						/>
					)}
					{images.length > 1 && (
						<div className="absolute inset-x-0 bottom-0 flex h-[max(128px,10vh)] items-end justify-center gap-3 bg-linear-to-t from-black/60 to-transparent pb-6 text-[13px] text-white/70">
							<button
								type="button"
								aria-label="Previous image"
								onClick={() => {
									step(-1);
								}}
								className={`${VIEWER_BUTTON} size-9`}
							>
								<ChevronLeft aria-hidden="true" className="size-5" />
							</button>
							<span className="flex h-9 items-center tabular-nums">
								{index + 1} of {images.length}
							</span>
							<button
								type="button"
								aria-label="Next image"
								onClick={() => {
									step(1);
								}}
								className={`${VIEWER_BUTTON} size-9`}
							>
								<ChevronRight aria-hidden="true" className="size-5" />
							</button>
						</div>
					)}
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
