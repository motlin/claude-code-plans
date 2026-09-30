import type {LucideIcon} from "lucide-react";

const SIZE_CLASS = {
	/** List rows: 36px tile, radius 8. */
	md: "size-9 rounded-r6",
	/** Detail headers: 44px tile, radius 12. */
	lg: "size-11 rounded-card",
} as const;

interface IconTileProps {
	icon: LucideIcon;
	size?: keyof typeof SIZE_CLASS;
}

/** Upstream `tabbed-list-icon-tile`: bordered surface-0 square holding a 20px glyph. */
export function IconTile({icon: Icon, size = "md"}: IconTileProps) {
	return (
		<div
			aria-hidden="true"
			data-testid="customize-icon-tile"
			className={`flex shrink-0 items-center justify-center border border-border bg-surface-0 text-secondary ${SIZE_CLASS[size]}`}
		>
			<Icon className="size-5" />
		</div>
	);
}
