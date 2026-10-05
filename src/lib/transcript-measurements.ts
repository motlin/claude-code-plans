interface TranscriptMeasurements {
	width: number;
	heights: ReadonlyMap<string, number>;
	range: {startIndex: number; endIndex: number};
}

export interface TranscriptReadingAnchor {
	entryKey: string;
	offset: number;
	atEnd: boolean;
}

interface TranscriptHandoff extends TranscriptMeasurements {
	source: object;
	anchor: TranscriptReadingAnchor;
}

const handoffs = new Map<string, TranscriptHandoff>();

/** A pane reparent can consume estimates only in the departing instance's commit. */
export function rememberTranscriptHandoff(key: string, snapshot: TranscriptHandoff): void {
	handoffs.set(key, snapshot);
	queueMicrotask(() => {
		if (handoffs.get(key) === snapshot) handoffs.delete(key);
	});
}

export function takeTranscriptHandoff(key: string, source: object): TranscriptHandoff | undefined {
	const snapshot = handoffs.get(key);
	handoffs.delete(key);
	return snapshot?.source === source ? snapshot : undefined;
}

interface RetainedMeasurements extends TranscriptMeasurements {
	source: WeakRef<object>;
}

const visits = new Map<string, RetainedMeasurements>();
const MAX_VISITS = 16;
const MAX_MEASURED_ROWS = 4096;

/** Pure read: a discarded render must not consume another visit's restoration. */
export function readTranscriptMeasurements(key: string, source: object): TranscriptMeasurements | undefined {
	const saved = visits.get(key);
	if (!saved || saved.source.deref() !== source) return undefined;
	return {width: saved.width, heights: saved.heights, range: saved.range};
}

/** Claim or discard a snapshot only from committed layout effects. */
export function discardTranscriptMeasurements(key: string): void {
	visits.delete(key);
}

/** Evict entire snapshots so partially remembered geometry is never reused. */
export function rememberTranscriptMeasurements(
	key: string,
	measurements: TranscriptMeasurements,
	source: object,
): void {
	visits.delete(key);
	if (measurements.heights.size === 0 || measurements.heights.size > MAX_MEASURED_ROWS) return;
	visits.set(key, {
		width: measurements.width,
		source: new WeakRef(source),
		heights: new Map(measurements.heights),
		range: {...measurements.range},
	});
	let rows = [...visits.values()].reduce((total, visit) => total + visit.heights.size, 0);
	for (const [oldestKey, oldest] of visits) {
		if (visits.size <= MAX_VISITS && rows <= MAX_MEASURED_ROWS) break;
		visits.delete(oldestKey);
		rows -= oldest.heights.size;
	}
}
