import { formatDistanceToNow } from "date-fns";

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

function parseTimestamp(timestamp?: string): Date | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Formats an ISO timestamp as an absolute, human-readable time. Returns just the
 * time of day for timestamps that fall on the current day, otherwise prefixes the
 * date. Returns null for missing or unparseable input.
 */
export function formatTimestamp(timestamp?: string): string | null {
  const date = parseTimestamp(timestamp);
  if (!date) return null;

  const time = date.toLocaleTimeString("en-US", TIME_FORMAT);
  const isToday = date.toDateString() === new Date().toDateString();
  if (isToday) return time;

  return `${date.toLocaleDateString("en-US", DATE_FORMAT)} ${time}`;
}

/**
 * Formats an ISO timestamp as a relative time (e.g. "about 2 hours ago").
 * Returns null for missing or unparseable input.
 */
export function formatRelativeTimestamp(timestamp?: string): string | null {
  const date = parseTimestamp(timestamp);
  if (!date) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}
