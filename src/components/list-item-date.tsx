import {formatListDate, formatShortDate} from "../lib/timestamp-format";

interface ListItemDateProps {
	iso: string;
	nowMs?: number;
}

/** A list row's trailing date: short under 640px so titles keep the row, the full date and time from sm up. */
export function ListItemDate({iso, nowMs}: ListItemDateProps) {
	return (
		<span className="ml-4 shrink-0 text-xs text-t6">
			<span className="sm:hidden">{formatShortDate(iso, nowMs)}</span>
			<span className="max-sm:hidden">{formatListDate(iso)}</span>
		</span>
	);
}
