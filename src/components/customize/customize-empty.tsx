import {Search} from "lucide-react";

/** Upstream no-match state: magnifier, "No <noun> match your search", "Try a different term." */
export function NoSearchMatches({noun}: {noun: string}) {
	return (
		<div role="status" className="flex flex-col items-center gap-3 py-16 text-center">
			<Search aria-hidden="true" className="size-10 text-t6" />
			<div className="flex flex-col gap-1">
				<h3 className="m-0 text-[15px]/[20px] font-[580] text-primary">No {noun} match your search</h3>
				<p className="m-0 text-body text-secondary">Try a different term.</p>
			</div>
		</div>
	);
}

/** Neutral card for a list with nothing in it yet, or a view that is not built yet. */
export function CustomizeNotice({title, body}: {title: string; body: string}) {
	return (
		<div className="flex flex-col gap-1 rounded-card bg-fill-ghost-hover p-4">
			<h3 className="m-0 text-[15px]/[20px] font-[580] text-primary">{title}</h3>
			<p className="m-0 text-body text-secondary">{body}</p>
		</div>
	);
}
