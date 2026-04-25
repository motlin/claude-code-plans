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

		it('detects minimal verbosity', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: false,
				showThinking: false,
				showPassedHooks: false,
				showHookWarnings: false,
				showHookErrors: false,
				showSystemBanners: false,
			};
			expect(detectVerbosity(settings)).toBe('minimal');
		});

		it('detects minimal verbosity even when showDebug is true', () => {
			const settings: Settings = {
				...DEFAULTS,
				showTools: false,
				showThinking: false,
				showPassedHooks: false,
				showHookWarnings: false,
				showHookErrors: false,
				showSystemBanners: false,
				showDebug: true,
			};
			expect(detectVerbosity(settings)).toBe('minimal');
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
				showDebug: true,
			};
			expect(detectVerbosity(settings)).toBe('verbose');
		});
	});
});
