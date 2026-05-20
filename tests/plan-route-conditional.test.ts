import {describe, expect, it} from 'vitest';
import {isPlanNotModified} from '../src/routes/api/plans.$filename';

describe('isPlanNotModified', () => {
	const mtime = new Date('2026-05-14T12:00:00.000Z');

	it('returns true when If-Modified-Since exactly matches the mtime floored to seconds', () => {
		expect(isPlanNotModified(mtime.toUTCString(), mtime)).toBe(true);
	});

	it('returns true when If-Modified-Since is strictly later than the mtime', () => {
		const later = new Date(mtime.getTime() + 5_000).toUTCString();
		expect(isPlanNotModified(later, mtime)).toBe(true);
	});

	it('returns true when the millisecond remainder of mtime is masked by HTTP-date precision', () => {
		// mtime carries sub-second precision; the header value is the same
		// instant truncated to seconds. The route is expected to floor
		// mtime before comparing, so this must still register as "not
		// modified".
		const fractional = new Date(mtime.getTime() + 750);
		expect(isPlanNotModified(mtime.toUTCString(), fractional)).toBe(true);
	});

	it('returns false when If-Modified-Since is strictly earlier than mtime', () => {
		const earlier = new Date(mtime.getTime() - 5_000).toUTCString();
		expect(isPlanNotModified(earlier, mtime)).toBe(false);
	});

	it('returns false when the header is missing', () => {
		expect(isPlanNotModified(null, mtime)).toBe(false);
	});

	it('returns false when the header is unparseable', () => {
		expect(isPlanNotModified('not a date', mtime)).toBe(false);
	});
});
