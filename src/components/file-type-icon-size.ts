/** Upstream `I`: icon box in px. */
export const FILE_TYPE_ICON_SIZE_PX = {xs: 12, sm: 16, md: 20, xl: 28} as const;

export type FileTypeIconSize = keyof typeof FILE_TYPE_ICON_SIZE_PX;
