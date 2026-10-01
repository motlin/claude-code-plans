const VARIANT_CLASS = {
	default: "rounded-r6 border border-border px-1.5 text-[11px] leading-4 font-normal text-ink-muted",
	palette: "rounded-r3 bg-alpha-1 px-1 text-[10px] leading-4 font-medium text-secondary",
} as const;

/** The muted "Archived" pill claude.ai/code shows on archived rows; `palette` is the ⌘K row chip. */
export function ArchivedBadge({variant = "default"}: {variant?: keyof typeof VARIANT_CLASS}) {
	return (
		<span data-archived-badge="" className={`shrink-0 ${VARIANT_CLASS[variant]}`}>
			Archived
		</span>
	);
}
