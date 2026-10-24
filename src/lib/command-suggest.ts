/**
 * Did-you-mean matching for mistyped slash commands, ported from upstream
 * claude.ai/code (cc43287c9 `g$`/`_$`).
 */

/** Optimal-string-alignment Damerau-Levenshtein distance. */
export function osaDistance(a: string, b: string): number {
	let previous: number[] = [];
	let current = Array.from({length: b.length + 1}, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let distance = Math.min(
				(current[j] ?? Infinity) + 1,
				(next[j - 1] ?? Infinity) + 1,
				(current[j - 1] ?? Infinity) + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				distance = Math.min(distance, (previous[j - 2] ?? Infinity) + 1);
			}
			next.push(distance);
		}
		previous = current;
		current = next;
	}
	return current[b.length] ?? Infinity;
}

/**
 * The unique closest candidate to `query`, or null when none is within the
 * threshold (1 for queries of four characters or fewer, else 2) or the
 * minimum is tied. Matching is case-insensitive; the candidate's own casing
 * is returned.
 */
export function nearestCommand(query: string, candidates: Iterable<string>): string | null {
	const needle = query.toLowerCase();
	const threshold = needle.length <= 4 ? 1 : 2;
	let best: string | null = null;
	let bestDistance = Infinity;
	let tied = false;
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const lowered = candidate.toLowerCase();
		if (lowered === needle || seen.has(lowered) || Math.abs(lowered.length - needle.length) > threshold) continue;
		seen.add(lowered);
		const distance = osaDistance(needle, lowered);
		if (distance > threshold) continue;
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
			tied = false;
		} else if (distance === bestDistance) {
			tied = true;
		}
	}
	return tied ? null : best;
}
