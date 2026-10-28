import type {LucideIcon} from "lucide-react";

const SIZE_CLASS = {
	/** List rows: 36px tile, radius 8. */
	md: "size-9 rounded-r6",
	/** Discover cards: 48px tile, radius 8. */
	card: "size-12 rounded-r6",
	/** Detail headers: 44px tile, radius 12. */
	lg: "size-11 rounded-card",
} as const;

/** Upstream's glyph is 20px everywhere but the Discover card, which uses 26px. */
const GLYPH_CLASS = {md: "size-5", card: "size-[26px]", lg: "size-5"} as const satisfies Record<
	keyof typeof SIZE_CLASS,
	string
>;

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
			className={`flex shrink-0 items-center justify-center border border-border bg-surface-0 text-muted-as-secondary ${SIZE_CLASS[size]}`}
		>
			<Icon className={GLYPH_CLASS[size]} />
		</div>
	);
}
