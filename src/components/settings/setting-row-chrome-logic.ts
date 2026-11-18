/*
 * Copy and rules for upstream's settings row chrome (c51ac4bf6 `J`, `De`, `q`, `be`, `Z`'s `x`), shared by
 * `setting-row-chrome.tsx` and the rows that draw it.
 */

/** Upstream `J(x, "name")`: the dot's aria-label. */
export function modifiedName(defaultLabel: string | undefined): string
{
	return defaultLabel === undefined ? "Changed from the default" : `Changed from the default (${defaultLabel})`;
}

/** Upstream `J(x, "sentence")`: the Reset tooltip. */
export function modifiedSentence(defaultLabel: string | undefined): string
{
	return `${modifiedName(defaultLabel)}.`;
}

/** Upstream `De`: a select or segmented row's default label is its default option's label. */
export function optionDefaultLabel<T>(
	options: ReadonlyArray<
	{
		readonly value: T;
		readonly label: string;
	}>,
	defaultValue: T,
): string | undefined
{
	return options.find((option) => option.value === defaultValue)?.label;
}

export type SettingScope = "account" | "device";

/** Where a row's value is stored: this app's per-browser settings, or Claude Code's settings.json. */
export type SettingStorage = "app" | "claudeCodeSetting";

/**
 * Upstream's `q`: a badge is needed when managed, or when the row's scope differs from its card's (upstream `ye`
 * provides the card scope; null outside any provider). Every local section is single-scope, like upstream's web
 * sections, so no local card provides one yet.
 */
export function needsScopeBadge(rowScope: SettingScope, providerScope: SettingScope | null, managed: boolean): boolean
{
	return managed || (providerScope !== null && providerScope !== rowScope);
}

/** Upstream `be`: the scope InfoTip sentence. */
export function scopeTooltip(scope: SettingScope, storage: SettingStorage, sessionOverridable: boolean): string
{
	const base =
		scope === "account"
			? "Applies on every device you sign in to."
			: storage === "claudeCodeSetting"
				? "Applies to Claude Code on this computer, including the terminal."
				: "Applies only on this computer.";
	return sessionOverridable ? `${base} New sessions start with it, and each session can change its own.` : base;
}

export interface SettingRowChromeProps
{
	modified: boolean;
	managed: boolean;
	defaultLabel?: string | undefined;
	/** The row's plain label, for "Reset {label} to default". */
	labelText: string;
	/** Omitted when the setting has no default to go back to (upstream shows the dot without Reset). */
	onReset?: (() => void) | undefined;
	/** Set when `needsScopeBadge` holds and the row isn't managed: the card scope differs from the row's. */
	scopeBadge?:
		|
		  {
				scope: SettingScope;
				tooltip: string;
		  }
		| undefined;
}

/** Whether the chrome strip draws anything (upstream's `x = gate && (scopeBadge || showModified)`). */
export function hasRowChrome({modified, managed, scopeBadge}: SettingRowChromeProps): boolean
{
	return managed || modified || scopeBadge !== undefined;
}
