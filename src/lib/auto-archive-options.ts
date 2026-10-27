import {z} from "zod";

/** Upstream's Archive inactive sessions choices (desktopPref `ccAutoArchiveInactiveDays`); 0 is Never. */
const AUTO_ARCHIVE_DAY_CHOICES = [0, 1, 2, 7, 14, 30] as const;

/** Whole days of inactivity before a session is archived, 0 for Never; up to ten years. */
export const AutoArchiveDaysSchema = z.number().int().min(0).max(3650);

export const DEFAULT_AUTO_ARCHIVE_DAYS = 0;

/** The `/api/auto-archive` body, both ways. */
export const AutoArchiveSettingSchema = z.strictObject({days: AutoArchiveDaysSchema});

function dayLabel(days: number): string {
	if (days === 0) return "Never";
	return days === 1 ? "1 day" : `${days} days`;
}

/** The select's items: the listed choices plus a stored non-listed value, ascending. */
export function autoArchiveDayOptions(current: number): Array<{value: string; label: string}> {
	const days = new Set<number>([...AUTO_ARCHIVE_DAY_CHOICES, current]);
	return [...days].toSorted((a, b) => a - b).map((value) => ({value: String(value), label: dayLabel(value)}));
}
