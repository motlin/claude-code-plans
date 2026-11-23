/**
 * Upstream's one-line path label: the directory part clips first so the basename stays visible, and a split label
 * carries the whole text as its accessible name since the clipped directory may be hidden.
 */
export function PathLabel({label, title}: {label: string; title?: string})
{
	const cut = label.lastIndexOf("/") + 1;
	const outer = "relative flex min-w-0 overflow-hidden whitespace-nowrap";
	if (cut === 0)
	{
		return (
			<span dir="ltr" className={outer} title={title}>
				<span className="min-w-0 truncate">{label}</span>
			</span>
		);
	}
	return (
		<span dir="ltr" className={outer} title={title} aria-label={label}>
			<span className="min-w-0 overflow-hidden">{label.slice(0, cut)}</span>
			<span className="max-w-full shrink-0 truncate">{label.slice(cut)}</span>
		</span>
	);
}
