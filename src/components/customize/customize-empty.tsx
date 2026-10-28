/** Neutral card for a list with nothing in it yet, or a view that is not built yet. */
export function CustomizeNotice({title, body}: {title: string; body: string}) {
	return (
		<div className="flex flex-col gap-1 rounded-card bg-fill-ghost-hover p-4">
			<h3 className="m-0 text-[15px]/[20px] font-[580] text-primary">{title}</h3>
			<p className="m-0 text-body text-secondary">{body}</p>
		</div>
	);
}
