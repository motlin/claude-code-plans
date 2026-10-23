import {createContext, useContext} from "react";

import type {SettingsTab} from "../../lib/settings-hash";

export interface SettingsRowIds {
	titleId: string;
	descriptionId: string | undefined;
}

export const SettingsRowContext = createContext<SettingsRowIds | null>(null);

/** The enclosing row's title/description ids, so controls can label themselves. */
export function useSettingsRowIds(): SettingsRowIds | null {
	return useContext(SettingsRowContext);
}

/** A deep-linked row to scroll to and flash; a new object re-flashes the same row. */
export interface SettingsFlash {
	row: string;
}

export const SettingsFlashContext = createContext<SettingsFlash | null>(null);

/** The Settings tab rendering these rows, so each row can carry upstream's `setting-<tab>-<row>` id. */
export const SettingsTabContext = createContext<SettingsTab | null>(null);
