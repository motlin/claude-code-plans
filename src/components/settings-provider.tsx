import {useCallback, useEffect, useState} from "react";

import {appearanceCssVars} from "../lib/appearance";
import {codeFontFamily} from "../lib/code-themes";
import {objectKeys} from "../lib/narrow";
import {
	DEFAULTS,
	detectVerbosity,
	dropRetiredSettings,
	migrateLegacyNotificationSetting,
	readStoredValue,
	type Settings,
	SettingsContext,
	STORAGE_KEYS,
	type Verbosity,
	VERBOSITY_KEYS,
	VERBOSITY_PRESETS,
	writeStoredValue,
} from "./settings-context";

export function SettingsProvider({children}: {children: React.ReactNode}) {
	const [settings, setSettings] = useState<Settings>(DEFAULTS);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		migrateLegacyNotificationSetting(localStorage);
		dropRetiredSettings(localStorage);
		const loaded = {...DEFAULTS};
		for (const key of objectKeys(DEFAULTS)) {
			const stored = readStoredValue(key);
			if (stored !== undefined) {
				(loaded as Record<keyof Settings, Settings[keyof Settings]>)[key] = stored;
			}
		}
		const rawVerbosity = localStorage.getItem(STORAGE_KEYS.verbosity);
		if (rawVerbosity === "minimal") {
			const normalPreset = VERBOSITY_PRESETS.normal;
			for (const key of objectKeys(normalPreset)) {
				const value = normalPreset[key];
				if (value === undefined) continue;
				(loaded as Record<keyof Settings, Settings[keyof Settings]>)[key] = value;
				writeStoredValue(key, value);
			}
			writeStoredValue("verbosity", "normal");
		}
		loaded.verbosity = detectVerbosity(loaded);
		setSettings(loaded);
		setLoaded(true);
	}, []);

	useEffect(() => {
		const root = document.documentElement;
		if (settings.motion === "reduced") root.dataset["motion"] = "reduced";
		else delete root.dataset["motion"];
	}, [settings.motion]);

	useEffect(() => {
		const style = document.documentElement.style;
		const family = codeFontFamily(settings.codeFont);
		if (family === null) style.removeProperty("--font-mono");
		else style.setProperty("--font-mono", family);
	}, [settings.codeFont]);

	useEffect(() => {
		const style = document.documentElement.style;
		const vars = appearanceCssVars({
			interfaceFont: settings.interfaceFont,
			transcriptTextSize: settings.transcriptTextSize,
			transcriptWidth: settings.transcriptWidth,
		});
		for (const [name, value] of Object.entries(vars)) {
			if (value === null) style.removeProperty(name);
			else style.setProperty(name, value);
		}
	}, [settings.interfaceFont, settings.transcriptTextSize, settings.transcriptWidth]);

	const setSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
		setSettings((previous) => {
			const next = {...previous, [key]: value};
			writeStoredValue(key, value);
			if (VERBOSITY_KEYS.includes(key)) {
				next.verbosity = detectVerbosity(next);
				writeStoredValue("verbosity", next.verbosity);
			}
			return next;
		});
	}, []);

	const setVerbosity = useCallback((verbosity: Verbosity) => {
		setSettings((previous) => {
			const preset = VERBOSITY_PRESETS[verbosity];
			const next = {...previous, ...preset, verbosity};
			for (const key of objectKeys(preset)) {
				writeStoredValue(key, next[key]);
			}
			writeStoredValue("verbosity", verbosity);
			return next;
		});
	}, []);

	const resetAll = useCallback(() => {
		for (const key of objectKeys(STORAGE_KEYS)) {
			localStorage.removeItem(STORAGE_KEYS[key]);
		}
		setSettings(DEFAULTS);
	}, []);

	return (
		<SettingsContext.Provider value={{settings, loaded, setSetting, setVerbosity, resetAll}}>
			{children}
		</SettingsContext.Provider>
	);
}
