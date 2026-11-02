import type {ReactNode} from "react";

import {FILE_TYPE_ICON_SIZE_PX, type FileTypeIconSize} from "./file-type-icon-size";
import {useFileTypeIcons} from "./file-type-icons-loader";

/** `FileTypeIcon` loaded on first use: an empty box of the same size until the icon set arrives (and during SSR). */
export function LazyFileTypeIcon({
	fileName,
	size,
	className,
}: {
	fileName: string;
	size: FileTypeIconSize;
	className?: string;
}): ReactNode
{
	const icons = useFileTypeIcons();
	if (icons === undefined)
	{
		const px = `${FILE_TYPE_ICON_SIZE_PX[size]}px`;
		return (
			<span
				aria-hidden="true"
				className={className ? `shrink-0 ${className}` : "shrink-0"}
				style={
				{
					width: px,
					height: px,
				}}
			/>
		);
	}
	return className === undefined ? (
		<icons.FileTypeIcon fileName={fileName} size={size} />
	) : (
		<icons.FileTypeIcon fileName={fileName} size={size} className={className} />
	);
}
