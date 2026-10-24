import {type ReactNode, useSyncExternalStore} from "react";

import {FILE_TYPE_ICON_SIZE_PX, type FileTypeIconSize} from "./file-type-icon-size";

export type FileTypeIconModule = typeof import("./file-type-icon");

// Keeps the file-type icon set out of the cold load; upstream also draws a placeholder while its icon JSON loads.
// Icons read the loaded module synchronously instead of suspending, so a late load never hides what is already open.
let fileTypeIconModule: FileTypeIconModule | undefined;
let fileTypeIconLoad: Promise<FileTypeIconModule> | undefined;
const fileTypeIconListeners = new Set<() => void>();

/** Starts loading the file-type icon set; the composer calls it on mount so the first `@` already has it. */
export async function preloadFileTypeIcons(): Promise<FileTypeIconModule> {
	fileTypeIconLoad ??= import("./file-type-icon").then((module) => {
		fileTypeIconModule = module;
		for (const listener of fileTypeIconListeners) listener();
		return module;
	});
	return fileTypeIconLoad;
}

function subscribeFileTypeIcons(listener: () => void): () => void {
	fileTypeIconListeners.add(listener);
	void preloadFileTypeIcons();
	return () => {
		fileTypeIconListeners.delete(listener);
	};
}

const loadedFileTypeIcons = () => fileTypeIconModule;
const serverFileTypeIcons = () => undefined;

/** The loaded `file-type-icon` module, or `undefined` until it arrives (always during SSR); subscribing starts the load. */
export function useFileTypeIcons(): FileTypeIconModule | undefined {
	return useSyncExternalStore(subscribeFileTypeIcons, loadedFileTypeIcons, serverFileTypeIcons);
}

/** `FileTypeIcon` loaded on first use: an empty box of the same size until the icon set arrives (and during SSR). */
export function LazyFileTypeIcon({
	fileName,
	size,
	className,
}: {
	fileName: string;
	size: FileTypeIconSize;
	className?: string;
}): ReactNode {
	const icons = useFileTypeIcons();
	if (icons === undefined) {
		const px = `${FILE_TYPE_ICON_SIZE_PX[size]}px`;
		return (
			<span
				aria-hidden="true"
				className={className ? `shrink-0 ${className}` : "shrink-0"}
				style={{width: px, height: px}}
			/>
		);
	}
	return className === undefined ? (
		<icons.FileTypeIcon fileName={fileName} size={size} />
	) : (
		<icons.FileTypeIcon fileName={fileName} size={size} className={className} />
	);
}
