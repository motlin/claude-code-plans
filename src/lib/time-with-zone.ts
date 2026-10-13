/**
 * Clock times written with a zone ("19:24 UTC", "3:05 pm EDT", "07:30 GMT+5:30"),
 * which upstream's assistant prose underlines with the reader's local time in a
 * tooltip. The pattern and zone tables mirror upstream's bundle.
 */

import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";
import {defined} from "./defined";

/** Fixed zone abbreviations, as minutes east of UTC. */
const ZONE_OFFSETS: Readonly<Record<string, number>> = {
	UTC: 0,
	GMT: 0,
	Z: 0,
	EST: -300,
	EDT: -240,
	CST: -360,
	CDT: -300,
	MST: -420,
	MDT: -360,
	PST: -480,
	PDT: -420,
	AKST: -540,
	AKDT: -480,
	HST: -600,
	AST: -240,
	ADT: -180,
	NST: -210,
	NDT: -150,
	WET: 0,
	WEST: 60,
	BST: 60,
	CET: 60,
	CEST: 120,
	EET: 120,
	EEST: 180,
	MSK: 180,
	IST: 330,
	PKT: 300,
	GST: 240,
	ICT: 420,
	WIB: 420,
	HKT: 480,
	SGT: 480,
	MYT: 480,
	PHT: 480,
	JST: 540,
	KST: 540,
	AWST: 480,
	ACST: 570,
	ACDT: 630,
	AEST: 600,
	AEDT: 660,
	NZST: 720,
	NZDT: 780,
};

/** US aliases that follow daylight saving, read in their IANA zone. */
const ZONE_ALIASES: Readonly<Record<string, string>> = {
	ET: "America/New_York",
	CT: "America/Chicago",
	MT: "America/Denver",
	PT: "America/Los_Angeles",
};

const WS = "[^\\S\\r\\n]";
const ZONE_NAMES = [...Object.keys(ZONE_OFFSETS), ...Object.keys(ZONE_ALIASES)].toSorted((a, b) => b.length - a.length);
const ZONED_TIME = new RegExp(
	`(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:(?:${WS}?([AaPp])(?:\\.[Mm]\\.|${WS}?[Mm]))?${WS}+|(?=Z\\b))(?:(?:UTC|GMT)([+\\u2212\\u2013-])(\\d{1,2})(?::?(\\d{2}))?|(${ZONE_NAMES.join("|")}))(?![\\w+\\u2212\\u2013-])`,
	"g",
);

export type TimeZoneRef = {offsetMinutes: number} | {timeZone: string};

export interface ZonedTime {
	/** Where the match starts in the searched text. */
	index: number;
	text: string;
	/** 0-23, after any am/pm. */
	hour: number;
	minute: number;
	second: number;
	zone: TimeZoneRef;
}

function clockHour(hour: number, meridiem: string | undefined): number | null {
	if (meridiem === undefined) return hour <= 23 ? hour : null;
	if (hour < 1 || hour > 12) return null;
	const pm = meridiem.toLowerCase() === "p";
	return (hour % 12) + (pm ? 12 : 0);
}

function zoneOf(match: RegExpExecArray): TimeZoneRef | null {
	const [, , , , , sign, offsetHours, offsetMinutes, name] = match;
	if (name !== undefined) {
		const alias = ZONE_ALIASES[name];
		return alias === undefined ? {offsetMinutes: defined(ZONE_OFFSETS[name], "zone offset")} : {timeZone: alias};
	}
	const minutes = Number(offsetHours) * 60 + Number(offsetMinutes ?? 0);
	const offset = sign === "+" ? minutes : -minutes;
	return offset < -720 || offset > 840 ? null : {offsetMinutes: offset};
}

/** Every valid zoned clock time in `text`, in order. A time with no zone never matches. */
export function findZonedTimes(text: string): ZonedTime[] {
	const found: ZonedTime[] = [];
	for (const match of text.matchAll(ZONED_TIME)) {
		const hour = clockHour(Number(match[1]), match[4]);
		const minute = Number(match[2]);
		const second = Number(match[3] ?? 0);
		const zone = zoneOf(match);
		if (hour === null || minute > 59 || second > 59 || zone === null) continue;
		found.push({index: match.index, text: match[0], hour, minute, second, zone});
	}
	return found;
}

/** Minutes `timeZone` runs ahead of UTC at `instant`. */
function zoneOffsetAt(timeZone: string, instant: number): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
	}).formatToParts(instant);
	const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
	return Math.round((wall - instant) / 60_000);
}

/** The instant the time names on the day `now` falls on in its zone. */
function instantOf(time: ZonedTime, now: Date): number {
	const offsetAt = (instant: number) =>
		"offsetMinutes" in time.zone ? time.zone.offsetMinutes : zoneOffsetAt(time.zone.timeZone, instant);
	const day = new Date(now.getTime() + offsetAt(now.getTime()) * 60_000);
	const wall = Date.UTC(
		day.getUTCFullYear(),
		day.getUTCMonth(),
		day.getUTCDate(),
		time.hour,
		time.minute,
		time.second,
	);
	const guess = wall - offsetAt(wall) * 60_000;
	return wall - offsetAt(guess) * 60_000;
}

/** The time as the reader's clock reads it, "3:24 PM EDT". */
export function localTimeLabel(time: ZonedTime, now: Date, timeZone?: string, locale?: string): string {
	return new Intl.DateTimeFormat(locale, {
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
		...(timeZone === undefined ? {} : {timeZone}),
	}).format(instantOf(time, now));
}

/**
 * Split each zoned clock time out of the prose's text runs into its own
 * `tokenType` token holding the time as written. Code and link text stay as written.
 */
export function splitZonedTimes(state: StateCore, tokenType: string): void {
	for (const block of state.tokens) {
		const children = block.type === "inline" ? block.children : null;
		if (children === null) continue;
		const rewritten: Token[] = [];
		let linkDepth = 0;
		for (const token of children) {
			if (token.type === "link_open") linkDepth++;
			if (token.type === "link_close") linkDepth--;
			const times = token.type === "text" && linkDepth === 0 ? findZonedTimes(token.content) : [];
			if (times.length === 0) {
				rewritten.push(token);
				continue;
			}
			let at = 0;
			const pushText = (content: string) => {
				if (content === "") return;
				const text = new state.Token("text", "", 0);
				text.content = content;
				rewritten.push(text);
			};
			for (const time of times) {
				pushText(token.content.slice(at, time.index));
				const zoned = new state.Token(tokenType, "span", 0);
				zoned.content = time.text;
				rewritten.push(zoned);
				at = time.index + time.text.length;
			}
			pushText(token.content.slice(at));
		}
		block.children = rewritten;
	}
}

/**
 * Upstream's zoned time: the time as written, dotted-underlined, with the
 * reader's local time for its tooltip.
 */
export function zonedTimeHtml(text: string, escape: (value: string) => string): string {
	const time = defined(findZonedTimes(text)[0], "zoned time token text");
	const local = localTimeLabel(time, new Date());
	return `<span data-testid="time-with-zone" class="time-with-zone" data-local-time="${escape(local)}">${escape(text)}</span>`;
}
