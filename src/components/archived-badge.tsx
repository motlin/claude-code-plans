/** The muted "Archived" pill claude.ai/code shows on archived rows under Status ▸ Archived or All. */
export function ArchivedBadge() {
	return (
		<span
			data-archived-badge=""
			className="shrink-0 rounded-r6 border border-border px-1.5 text-[11px] leading-4 font-normal text-ink-muted"
		>
			Archived
		</span>
	);
}
