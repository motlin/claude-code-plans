import {DEFAULTS, VERBOSITY_KEYS, detectVerbosity, type Settings} from '../src/components/settings-provider';

describe('settings-provider', () => {
	describe('VERBOSITY_KEYS', () => {
		it('does not include showDebug', () => {
			expect(VERBOSITY_KEYS).not.toContain('showDebug');
		});

		it('includes the expected content-related keys', () => {
			expect(VERBOSITY_KEYS).toContain('showTools');
			expect(VERBOSITY_KEYS).toContain('showThinking');
			expect(VERBOSITY_KEYS).toContain('showPassedHooks');
			expect(VERBOSITY_KEYS).toContain('showHookWarnings');
			expect(VERBOSITY_KEYS).toContain('showHookErrors');
			expect(VERBOSITY_KEYS).toContain('showSystemBanners');
			expect(VERBOSITY_KEYS).toContain('showCompactSummaries');
			expect(VERBOSITY_KEYS).toContain('showTranscriptOnly');
		});
	});

	describe('detectVerbosity', () => {
		it('detects normal verbosity with default settings', () => {
			expect(detectVerbosity(DEFAULTS)).toBe('normal');
		});

		it('detects normal verbosity when showDebug is true', () => {
			const settings: Settings = {...DEFAULTS, showDebug: true};
			expect(detectVerbosity(settings)).toBe('normal');
		});

		it('detects thinking verbosity', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: true,
				showThinking: true,
				showPassedHooks: false,
				showHookWarnings: true,
				showHookErrors: true,
				showSystemBanners: false,
			};
			expect(detectVerbosity(settings)).toBe('thinking');
		});

		it('detects thinking verbosity even when showDebug is true', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: true,
				showThinking: true,
				showPassedHooks: false,
				showHookWarnings: true,
				showHookErrors: true,
				showSystemBanners: false,
				showDebug: true,
			};
			expect(detectVerbosity(settings)).toBe('thinking');
		});

		it('does not detect removed minimal preset', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: false,
				showThinking: false,
				showPassedHooks: false,
				showHookWarnings: false,
				showHookErrors: false,
				showSystemBanners: false,
				verbosity: 'normal',
			};
			expect(detectVerbosity(settings)).toBe('normal');
		});

		it('detects verbose verbosity', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: true,
				showThinking: true,
				showPassedHooks: true,
				showHookWarnings: true,
				showHookErrors: true,
				showSystemBanners: true,
				showCompactSummaries: true,
				showTranscriptOnly: true,
			};
			expect(detectVerbosity(settings)).toBe('verbose');
		});

		it('detects verbose verbosity even when showDebug is true', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: true,
				showThinking: true,
				showPassedHooks: true,
				showHookWarnings: true,
				showHookErrors: true,
				showSystemBanners: true,
				showCompactSummaries: true,
				showTranscriptOnly: true,
				showDebug: true,
			};
			expect(detectVerbosity(settings)).toBe('verbose');
		});

		it('does NOT detect verbose when showCompactSummaries is false', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: true,
				showThinking: true,
				showPassedHooks: true,
				showHookWarnings: true,
				showHookErrors: true,
				showSystemBanners: true,
				showCompactSummaries: false,
				showTranscriptOnly: true,
			};
			expect(detectVerbosity(settings)).not.toBe('verbose');
		});

		it('does NOT detect verbose when showTranscriptOnly is false', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: true,
				showThinking: true,
				showPassedHooks: true,
				showHookWarnings: true,
				showHookErrors: true,
				showSystemBanners: true,
				showCompactSummaries: true,
				showTranscriptOnly: false,
			};
			expect(detectVerbosity(settings)).not.toBe('verbose');
		});

		it('falls back to saved verbosity when showCompactSummaries deviates from normal preset', () => {
			// settings.verbosity ('normal') is returned as a fallback because no
			// preset matches exactly; that's distinct from "this matches normal".
			const settings: Settings = {...DEFAULTS, showCompactSummaries: true, verbosity: 'verbose'};
			expect(detectVerbosity(settings)).toBe('verbose');
		});

		it('falls back to saved verbosity when showTranscriptOnly deviates from normal preset', () => {
			const settings: Settings = {...DEFAULTS, showTranscriptOnly: true, verbosity: 'verbose'};
			expect(detectVerbosity(settings)).toBe('verbose');
		});

		it('does NOT detect thinking when showCompactSummaries is true', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: true,
				showThinking: true,
				showPassedHooks: false,
				showHookWarnings: true,
				showHookErrors: true,
				showSystemBanners: false,
				showCompactSummaries: true,
				showTranscriptOnly: false,
			};
			expect(detectVerbosity(settings)).not.toBe('thinking');
		});

		it('does NOT detect thinking when showTranscriptOnly is true', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: true,
				showThinking: true,
				showPassedHooks: false,
				showHookWarnings: true,
				showHookErrors: true,
				showSystemBanners: false,
				showCompactSummaries: false,
				showTranscriptOnly: true,
			};
			expect(detectVerbosity(settings)).not.toBe('thinking');
		});
	});
});
