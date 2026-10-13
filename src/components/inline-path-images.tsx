import type {SyntheticEvent} from "react";
import {extractInlineImagePaths, isPathInsideAllowedImageRoot} from "./inline-image-paths";

export const SESSION_IMAGE_CLASS_NAME = "max-w-full max-h-96 rounded-lg border border-border shadow-sm";

function hideFailedImage(event: SyntheticEvent<HTMLImageElement>): void {
	event.currentTarget.style.display = "none";
}

export function InlinePathImages({text, allowedRoots}: {text: string; allowedRoots: readonly string[]}) {
	const paths = extractInlineImagePaths(text).filter((path) => isPathInsideAllowedImageRoot(path, allowedRoots));

	if (paths.length === 0) return null;

	return (
		<>
			{paths.map((path) => {
				const imageUrl = `/api/image?path=${encodeURIComponent(path)}`;
				return (
					<a key={path} href={imageUrl} target="_blank" rel="noopener noreferrer" className="cursor-zoom-in">
						<img
							src={imageUrl}
							alt={`Referenced file ${path}`}
							className={SESSION_IMAGE_CLASS_NAME}
							loading="lazy"
							onError={hideFailedImage}
						/>
					</a>
				);
			})}
		</>
	);
}
