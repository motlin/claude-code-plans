import {QueryClientContext} from "@tanstack/react-query";
import
{
	cloneElement,
	type CSSProperties,
	type MouseEvent,
	type ReactElement,
	type SyntheticEvent,
	useContext,
	useRef,
	useState,
} from "react";

import {isFileRefGone} from "../lib/api/file-refs";
import {attachContext} from "../lib/context-attach";
import {useFileRefsCwd} from "./file-refs-context";
import {FileActionsMenuItems} from "./files/file-actions-menu";
import {useToast} from "./toast-context";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem} from "./ui/menu";

/*
 * Upstream's image ContextMenu (c81abc216 `j`): Copy image · Save image, then
 * the shared file actions when the image has a path. Its trigger stops the
 * right-click so the transcript menu around it stays shut.
 */

/** Upstream `D`: a file name kept as the download name. */
const IMAGE_FILE_NAME = /\.(png|jpe?g|jfif|gif|webp|bmp|avif|heic|heif|tiff?|ico)$/i;

/** Upstream `S`: a base64 data URL decoded without a fetch. */
function dataUrlBlob(src: string): Blob | null
{
	const [, type, data] = /^data:([^,]*?);base64,(.*)$/is.exec(src) ?? [];
	if (data === undefined) return null;
	let binary: string;
	try
	{
		binary = atob(data);
	}
	catch
	{
		return null;
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return new Blob(
		[bytes],
		{
			type: type ?? "",
		},
	);
}

/** Upstream `C`. */
async function imageBlob(src: string): Promise<Blob>
{
	const decoded = dataUrlBlob(src);
	if (decoded !== null) return decoded;
	const response = await fetch(src);
	if (!response.ok) throw new Error(`Failed to load image: ${response.status}`);
	return response.blob();
}

/** Upstream `w`: the clipboard takes only PNG, so other types go through a canvas. */
async function pngBlob(blob: Blob): Promise<Blob>
{
	if (blob.type === "image/png") return blob;
	const url = URL.createObjectURL(blob);
	try
	{
		const image = new Image();
		await new Promise<void>((resolve, reject) =>
		{
			image.addEventListener("load", () =>
			{
				resolve();
			});
			image.addEventListener("error", () =>
			{
				reject(new Error("Image decode failed"));
			});
			image.src = url;
		});
		const canvas = document.createElement("canvas");
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		const context = canvas.getContext("2d");
		if (context === null) throw new Error("2d canvas context unavailable");
		context.drawImage(image, 0, 0);
		return await new Promise<Blob>((resolve, reject) =>
		{
			canvas.toBlob((png) =>
			{
				if (png === null) reject(new Error("canvas.toBlob returned null"));
				else resolve(png);
			}, "image/png");
		});
	}
	finally
	{
		URL.revokeObjectURL(url);
	}
}

/** Upstream `T`. */
function extensionOf(type: string): string
{
	const lower = type.toLowerCase();
	if (lower.includes("png")) return "png";
	if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
	for (const extension of ["gif", "webp", "avif", "heic", "bmp"]) if (lower.includes(extension)) return extension;
	return "png";
}

/** Upstream `O`. */
async function saveImage(src: string, fileName: string | undefined): Promise<void>
{
	const blob = await imageBlob(src);
	const extension = extensionOf(blob.type);
	const name =
		fileName !== undefined && IMAGE_FILE_NAME.test(fileName) ? fileName : `image-${Date.now()}.${extension}`;
	const url = URL.createObjectURL(blob);
	try
	{
		const link = document.createElement("a");
		link.href = url;
		link.download = name;
		document.body.append(link);
		link.click();
		link.remove();
	}
	finally
	{
		setTimeout(() =>
		{
			URL.revokeObjectURL(url);
		}, 1000);
	}
}

/** Upstream `A`: the Copy image and Save image rows. */
function ImageMenuItems({src, fileName}: {src: string; fileName: string | undefined})
{
	const toast = useToast();
	return (
		<>
			<MenuItem
				onSelect={() =>
				{
					navigator.clipboard
						.write([
							new ClipboardItem(
								{
									"image/png": imageBlob(src).then(pngBlob),
								},
							),
						])
						.then(
							() =>
							{
								toast(
									{
										kind: "success",
										message: "Image copied to clipboard.",
									},
								);
							},
							() =>
							{
								toast(
									{
										kind: "error",
										message: "Couldn’t copy image.",
									},
								);
							},
						);
				}}
			>
				Copy image
			</MenuItem>
			<MenuItem
				onSelect={() =>
				{
					saveImage(src, fileName).catch(() =>
					{
						toast(
							{
								kind: "error",
								message: "Couldn’t save image.",
							},
						);
					});
				}}
			>
				Save image
			</MenuItem>
		</>
	);
}

function stopPropagation(event: SyntheticEvent): void
{
	event.stopPropagation();
}

function preventDefault(event: SyntheticEvent): void
{
	event.preventDefault();
}

interface ImageChildProps
{
	onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
	tabIndex?: number;
	style?: CSSProperties;
}

export interface ImageContextMenuProps
{
	src: string;
	/** Kept as the Save image name when it has an image extension; defaults to the path's file name. */
	fileName?: string | undefined;
	/** The image's file on disk: adds the file actions block. */
	path?: string | undefined;
	/** The session Attach as context adds the file to; without it the row is left out. */
	sessionId?: string | undefined;
	/** A tile that can't open its menu: the right-click still stops here, so the browser menu shows. */
	disabled?: boolean;
	children: ReactElement<ImageChildProps>;
}

export function ImageContextMenu({src, fileName, path, sessionId, disabled = false, children}: ImageContextMenuProps)
{
	const cwd = useFileRefsCwd();
	const queryClient = useContext(QueryClientContext);
	const [gone, setGone] = useState(false);
	const goneCheck = useRef<Promise<boolean> | null>(null);
	const childOnContextMenu = children.props.onContextMenu;
	const trigger = cloneElement(
		children,
		{
			onContextMenu: (event: MouseEvent<HTMLElement>) =>
			{
				event.stopPropagation();
				childOnContextMenu?.(event);
			},
			tabIndex: children.props.tabIndex ?? -1,
			style:
			{
				outline: "none",
				...children.props.style,
			},
		},
	);
	return (
		<ContextMenu
			disabled={disabled}
			onOpenChange={(open) =>
			{
				// Upstream `U` with reveal "checked": recheck the path as the menu opens.
				if (!open || path === undefined || queryClient === undefined) return;
				setGone(false);
				const check = isFileRefGone(queryClient, path);
				goneCheck.current = check;
				void check.then((isGone) =>
				{
					if (goneCheck.current === check) setGone(isGone);
				});
			}}
		>
			<ContextMenuTrigger render={trigger} />
			<MenuContent
				popupProps={
				{
					onClick: stopPropagation,
					onKeyDown: stopPropagation,
					onContextMenu: preventDefault,
				}}
			>
				<ImageMenuItems src={src} fileName={fileName ?? path?.split("/").at(-1)} />
				{path !== undefined && (
					<FileActionsMenuItems
						path={path}
						cwd={cwd}
						surface="attachment"
						separatorBefore
						gone={gone}
						onAttachContext={
							sessionId === undefined
								? undefined
								: (attachment) =>
									{
										attachContext(sessionId, attachment);
									}
						}
					/>
				)}
			</MenuContent>
		</ContextMenu>
	);
}
