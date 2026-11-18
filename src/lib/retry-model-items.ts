/*
 * Upstream's classic `modelItems` list (cc89b848f), whose one rendered consumer is the API error card's
 * "Switch model and retry" menu: the main rows, a "More models" group, and a pinned first row for a running model
 * neither list has. Locally the rows are the static catalog (`modelRowsFor`), not the server's.
 */
import type {ComposerState} from "./composer-state";
import
{
	catalogMenuValue,
	DEFAULT_MODEL_CATALOG,
	type ModelCatalog,
	type ModelChoice,
	modelLabel,
	modelRowsFor,
	moreModelsMenuValue,
	primaryModelMenuValue,
} from "./launch-options";
import {modelRestriction} from "./model-restrictions";

/** Upstream's `legacyModelTooltip` (`V7kWHc`), the pinned row's description for a deprecated model. */
const LEGACY_MODEL_DESCRIPTION = "Previous-generation model. May be removed in a future update.";

/** Upstream's `availableModelsSuffix` (`UpwcFd`) and the pinned deprecated row's suffix. */
const UNAVAILABLE_SUFFIX = "Unavailable";

export interface RetryModelItem
{
	/** What picking the row switches to: a catalog row id, or the running id for the pinned row. */
	value: string;
	label: string;
	checked: boolean;
	disabled?: true;
	/** Muted text after the label: upstream's "Unavailable". */
	suffix?: string;
	/** A disabled row's reason, upstream's tooltip shown as the row's second line. */
	description?: string;
	/** The settings model's trailing badge: "Default" or "Set by admin". */
	badge?: string;
}

export interface RetryModelItems
{
	/** The running model when neither list has it; upstream puts it first, with no separator after it. */
	pinned?: RetryModelItem;
	main: RetryModelItem[];
	/** Upstream's "More models" group, after a separator. */
	more: RetryModelItem[];
}

/** Upstream's `lr` decoration: the settings model's row, badged "Set by admin" from managed settings. */
export interface RetryModelDefault
{
	/** The row value the settings model selects (or the running id, for the pinned row). */
	value: string;
	managed: boolean;
}

function badgeFor(value: string, defaultModel: RetryModelDefault | null): string | undefined
{
	if (defaultModel?.value !== value) return undefined;
	return defaultModel.managed ? "Set by admin" : "Default";
}

function catalogRows(
	rows: readonly ModelChoice[],
	checked: string,
	restrictionFor: ((id: string) => string | undefined) | undefined,
	defaultModel: RetryModelDefault | null,
): RetryModelItem[]
{
	return rows.map((row) =>
	{
		const isChecked = row.id === checked;
		// Upstream skips the restriction for the current row (`e.model===Q`).
		const restriction = isChecked ? undefined : restrictionFor?.(row.id);
		const badge = badgeFor(row.id, defaultModel);
		return {
			value: row.id,
			label: row.label,
			checked: isChecked,
			...(restriction !== undefined &&
			{
				disabled: true,
				suffix: UNAVAILABLE_SUFFIX,
				description: restriction,
			}),
			...(badge !== undefined &&
			{
				badge,
			}),
		};
	});
}

/** The pinned current row: disabled "Unavailable" with the Legacy description when deprecated, else a plain checked row. */
function pinnedRow(current: string, deprecated: boolean, defaultModel: RetryModelDefault | null): RetryModelItem
{
	const badge = badgeFor(current, defaultModel);
	return {
		value: current,
		label: modelLabel(current),
		checked: true,
		...(deprecated &&
		{
			disabled: true,
			suffix: UNAVAILABLE_SUFFIX,
			description: LEGACY_MODEL_DESCRIPTION,
		}),
		...(badge !== undefined &&
		{
			badge,
		}),
	};
}

/** How the menu dresses the catalog rows; every field is optional. */
export interface RetryModelOptions
{
	/** The rows, with any `[1m]` twins (`modelRowsFor`). */
	catalog?: ModelCatalog;
	/** Why settings' `availableModels` leaves a row out, or undefined when it may run. */
	restrictionFor?: ((id: string) => string | undefined) | undefined;
	/** The settings model's row, badged "Default" / "Set by admin". */
	defaultModel?: RetryModelDefault | null;
	/** Stands in for the server catalog's deprecated sections, which have no local source. */
	isDeprecated?: (id: string) => boolean;
}

/** The Model menu's host transform from settings: `[1m]` twin rows, `availableModels` restrictions, the default badge. */
export function settingsModelMenu(
	state: Pick<ComposerState, "settingsDefault" | "availableModels">,
): Required<Pick<RetryModelOptions, "catalog" | "restrictionFor" | "defaultModel">>
{
	const {settingsDefault, availableModels} = state;
	const catalog = modelRowsFor(
		{
			settingsModel: settingsDefault?.id ?? null,
			availableModels: availableModels?.value,
		},
	);
	return {
		catalog,
		restrictionFor: modelRestriction(catalog, availableModels),
		defaultModel:
			settingsDefault === null
				? null
				:
					{
						value: catalogMenuValue(settingsDefault.id, catalog) ?? settingsDefault.id,
						managed: settingsDefault.managed,
					},
	};
}

/**
 * Upstream's classic item builder: the current model checks its main or More models row, else it is pinned first.
 */
export function retryModelItems({
	current,
	catalog = DEFAULT_MODEL_CATALOG,
	restrictionFor,
	defaultModel = null,
	isDeprecated = () => false,
}: RetryModelOptions &
{
	current: string | undefined;
}): RetryModelItems
{
	const primary = primaryModelMenuValue(current, catalog);
	const more = moreModelsMenuValue(current, catalog);
	const listed = catalog.primary.some((row) => row.id === primary) || catalog.more.some((row) => row.id === more);
	const items: RetryModelItems =
	{
		main: catalogRows(catalog.primary, primary, restrictionFor, defaultModel),
		more: catalogRows(catalog.more, more, restrictionFor, defaultModel),
	};
	if (current === undefined || listed) return items;
	return {
		pinned: pinnedRow(current, isDeprecated(current), defaultModel),
		...items,
	};
}
