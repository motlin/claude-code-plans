import {createContext, useCallback, useContext, useEffect, useState} from 'react';

type SubagentView = 'tree' | 'gantt' | 'sequence';
export type Verbosity = 'minimal' | 'normal' | 'verbose';

export interface Settings {
	showThinking: boolean;
	showTools: boolean;
	showTimestamps: boolean;
	showDebug: boolean;
	showToolDuration: boolean;

	showPassedHooks: boolean;
	showHookErrors: boolean;

	showSystemBanners: boolean;

	defaultSubagentView: SubagentView;

	chromeHidden: boolean;
	statusFooterVisible: boolean;

	autoGenerateSummaries: boolean;

	collapseThreshold: number;
	activeTimeoutSec: number;

	verbosity: Verbosity;
}

const DEFAULTS: Settings = {
	showThinking: false,
	showTools: true,
	showTimestamps: false,
	showDebug: false,
	showToolDuration: true,

	showPassedHooks: false,
	showHookErrors: false,

	showSystemBanners: false,

	defaultSubagentView: 'tree',

	chromeHidden: false,
	statusFooterVisible: true,

	autoGenerateSummaries: false,

	collapseThreshold: 3,
	activeTimeoutSec: 60,

	verbosity: 'normal',
};

const STORAGE_KEYS: Record<keyof Settings, string> = {
	showThinking: 'ccp-show-thinking',
	showTools: 'ccp-show-tools',
	showTimestamps: 'ccp-show-timestamps',
	showDebug: 'ccp-show-debug',
	showToolDuration: 'ccp-show-tool-duration',
	showPassedHooks: 'ccp-show-passed-hooks',
	showHookErrors: 'ccp-show-hook-errors',
	showSystemBanners: 'ccp-show-system-banners',
	defaultSubagentView: 'ccp-subagent-view',
	chromeHidden: 'ccp-chrome-hidden',
	statusFooterVisible: 'ccp-status-footer',
	autoGenerateSummaries: 'ccp-auto-summaries',
	collapseThreshold: 'ccp-collapse-threshold',
	activeTimeoutSec: 'ccp-active-timeout',
	verbosity: 'ccp-verbosity',
};

const VERBOSITY_PRESETS: Record<Exclude<Verbosity, 'minimal'>, Partial<Settings>> & {minimal: Partial<Settings>} = {
	minimal: {
		showTools: false,
		showThinking: false,
		showPassedHooks: false,
		showHookErrors: false,
		showSystemBanners: false,
		showTimestamps: false,
		showDebug: false,
	},
	normal: {
		showTools: true,
		showThinking: false,
		showPassedHooks: false,
		showHookErrors: false,
		showSystemBanners: false,
		showTimestamps: false,
		showDebug: false,
	},
	verbose: {
		showTools: true,
		showThinking: true,
		showPassedHooks: true,
		showHookErrors: true,
		showSystemBanners: true,
		showTimestamps: true,
		showDebug: false,
	},
};

const VERBOSITY_KEYS = Object.keys(VERBOSITY_PRESETS.normal) as Array<keyof Settings>;

function detectVerbosity(settings: Settings): Verbosity {
	for (const preset of ['minimal', 'normal', 'verbose'] as const) {
		const values = VERBOSITY_PRESETS[preset];
		if (VERBOSITY_KEYS.every((key) => settings[key] === values[key])) {
			return preset;
		}
	}
	return settings.verbosity;
}

function readStoredValue<K extends keyof Settings>(key: K): Settings[K] | undefined {
	const storageKey = STORAGE_KEYS[key];
	const stored = localStorage.getItem(storageKey);
	if (stored === null) return undefined;

	const defaultValue = DEFAULTS[key];
	if (typeof defaultValue === 'boolean') {
		return (stored === 'true') as Settings[K];
	}
	if (typeof defaultValue === 'number') {
		const parsed = Number(stored);
		return (Number.isFinite(parsed) ? parsed : undefined) as Settings[K] | undefined;
	}
	return stored as Settings[K];
}

function writeStoredValue<K extends keyof Settings>(key: K, value: Settings[K]): void {
	localStorage.setItem(STORAGE_KEYS[key], String(value));
}

interface SettingsContextValue {
	settings: Settings;
	setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
	setVerbosity: (verbosity: Verbosity) => void;
	resetAll: () => void;
}

const SettingsContext = createContext<SettingsContextValue>({
	settings: DEFAULTS,
	setSetting: () => undefined,
	setVerbosity: () => undefined,
	resetAll: () => undefined,
});

export function SettingsProvider({children}: {children: React.ReactNode}) {
	const [settings, setSettings] = useState<Settings>(DEFAULTS);

	useEffect(() => {
		const loaded = {...DEFAULTS};
		for (const key of Object.keys(DEFAULTS) as Array<keyof Settings>) {
			const stored = readStoredValue(key);
			if (stored !== undefined) {
				(loaded as Record<keyof Settings, Settings[keyof Settings]>)[key] = stored;
			}
		}
		loaded.verbosity = detectVerbosity(loaded);
		setSettings(loaded);
	}, []);

	const setSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
		setSettings((previous) => {
			const next = {...previous, [key]: value};
			writeStoredValue(key, value);
			if (VERBOSITY_KEYS.includes(key)) {
				next.verbosity = detectVerbosity(next);
				writeStoredValue('verbosity', next.verbosity);
			}
			return next;
		});
	}, []);

	const setVerbosity = useCallback((verbosity: Verbosity) => {
		setSettings((previous) => {
			const preset = VERBOSITY_PRESETS[verbosity];
			const next = {...previous, ...preset, verbosity};
			for (const key of Object.keys(preset) as Array<keyof Settings>) {
				writeStoredValue(key, next[key]);
			}
			writeStoredValue('verbosity', verbosity);
			return next;
		});
	}, []);

	const resetAll = useCallback(() => {
		for (const key of Object.keys(STORAGE_KEYS) as Array<keyof Settings>) {
			localStorage.removeItem(STORAGE_KEYS[key]);
		}
		setSettings(DEFAULTS);
	}, []);

	return (
		<SettingsContext.Provider value={{settings, setSetting, setVerbosity, resetAll}}>
			{children}
		</SettingsContext.Provider>
	);
}

export function useSettings(): SettingsContextValue {
	return useContext(SettingsContext);
}
