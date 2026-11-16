/** Upstream's elapsed-time formats (`nW`), kept apart from the working marker so light modules can share them. */

const ELAPSED_UNITS = [
	{
		unit: "day",
		seconds: 86_400,
	},
	{
		unit: "hour",
		seconds: 3600,
	},
	{
		unit: "minute",
		seconds: 60,
	},
	{
		unit: "second",
		seconds: 1,
	},
] as const;

type ElapsedUnit = (typeof ELAPSED_UNITS)[number]["unit"];

function formatUnit(value: number, unit: ElapsedUnit, pad = false): string
{
	try
	{
		return new Intl.NumberFormat(
			"en",
			{
				style: "unit",
				unit,
				unitDisplay: "narrow",
				minimumIntegerDigits: pad ? 2 : 1,
			},
		).format(value);
	}
	catch
	{
		return `${String(value).padStart(pad ? 2 : 1, "0")}${unit[0]}`;
	}
}

/**
 * Upstream's elapsed format (`nW`): up to three consecutive units starting at
 * the largest non-zero one, zero units dropped, no padding ("1m 5s", "1h 2m 5s").
 */
export function formatElapsed(totalSeconds: number): string
{
	const start = ELAPSED_UNITS.findIndex(({seconds}) => totalSeconds >= seconds);
	if (start === -1) return formatUnit(0, "second");
	let remaining = totalSeconds;
	const parts: string[] = [];
	for (const {unit, seconds} of ELAPSED_UNITS.slice(start, start + 3))
	{
		const value = Math.floor(remaining / seconds);
		remaining -= value * seconds;
		if (value > 0) parts.push(formatUnit(value, unit));
	}
	return parts.join(" ");
}

/**
 * Upstream's `nW` with `padTrailingUnits`, the workflow card's timer: up to
 * three consecutive units from the largest non-zero one, zeros kept, every
 * unit after the first except days two digits wide ("1m 05s", "1h 00m 00s").
 */
export function formatPaddedElapsed(totalSeconds: number): string
{
	const start = ELAPSED_UNITS.findIndex(({seconds}) => totalSeconds >= seconds);
	if (start === -1) return formatUnit(0, "second");
	let remaining = totalSeconds;
	return ELAPSED_UNITS.slice(start, start + 3)
		.map(({unit, seconds}, i) =>
		{
			const value = Math.floor(remaining / seconds);
			remaining -= value * seconds;
			return formatUnit(value, unit, i > 0 && unit !== "day");
		})
		.join(" ");
}
