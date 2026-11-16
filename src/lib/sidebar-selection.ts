import {assertNever} from "./assert-never";

/**
 * The sidebar's multi-row selection, like claude.ai/code: ⌘-click (Ctrl-click
 * elsewhere) toggles a row, ⇧-click selects the range from the anchor, and a
 * plain click, Escape, or a press outside the list clears it. Selected ids stay in display order so bulk
 * actions and multi-row drags keep the rows' relative order.
 */

export interface SidebarSelection
{
	readonly ids: readonly string[];
	/** The row a ⇧-click range starts from: the last row ⌘-clicked into the selection. */
	readonly anchor: string | null;
}

export type SidebarSelectionAction =
	|
	  {
			readonly type: "toggle";
			readonly id: string;
			readonly order: readonly string[];
	  }
	|
	  {
			readonly type: "extend";
			readonly id: string;
			readonly order: readonly string[];
			/** The open session, where a range starts when nothing is anchored yet. */
			readonly focusedId: string | null;
	  }
	/** Select all on a group header: adds the group's shown rows to the selection. */
	|
	  {
			readonly type: "add";
			readonly ids: readonly string[];
			readonly order: readonly string[];
	  }
	/** Select all on the list's empty space: replaces the selection with these rows. */
	|
	  {
			readonly type: "set";
			readonly ids: readonly string[];
			readonly order: readonly string[];
	  }
	|
	  {
			readonly type: "clear";
	  };

export const EMPTY_SELECTION: SidebarSelection =
{
	ids: [],
	anchor: null,
};

export type SelectionClickKind = "plain" | "toggle" | "extend";

export function selectionClickKind(modifiers: {
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
}): SelectionClickKind
{
	if (modifiers.shiftKey) return "extend";
	if (modifiers.metaKey || modifiers.ctrlKey) return "toggle";
	return "plain";
}

/** Where a press keeps the selection (upstream `TP`): rows, `[data-kind]` lists, portals, poppers, menus and dialogs. */
const SELECTION_KEEP_SELECTOR =
	'[data-row-key], [data-kind], [data-cds-portal], [data-radix-popper-content-wrapper], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

/** Upstream `TP`: only a plain primary press (⌥ allowed) outside {@link SELECTION_KEEP_SELECTOR} clears the selection. */
export function clearsSelectionOnPress(
	event: Pick<PointerEvent, "shiftKey" | "metaKey" | "ctrlKey" | "button" | "target">,
): boolean
{
	if (event.shiftKey || event.metaKey || event.ctrlKey || event.button !== 0) return false;
	return !(event.target instanceof Element && event.target.closest(SELECTION_KEEP_SELECTOR) !== null);
}

function inOrder(ids: ReadonlySet<string>, order: readonly string[]): string[]
{
	const shown = order.filter((id) => ids.has(id));
	const rest = [...ids].filter((id) => !order.includes(id));
	return [...shown, ...rest];
}

export function sidebarSelectionReducer(state: SidebarSelection, action: SidebarSelectionAction): SidebarSelection
{
	switch (action.type)
	{
		case "clear":
			return state.ids.length === 0 && state.anchor === null ? state : EMPTY_SELECTION;
		case "toggle":
		{
			const ids = new Set(state.ids);
			if (ids.has(action.id))
			{
				ids.delete(action.id);
				const remaining = inOrder(ids, action.order);
				const anchor =
					state.anchor !== null && ids.has(state.anchor) ? state.anchor : (remaining.at(-1) ?? null);
				return {
					ids: remaining,
					anchor,
				};
			}
			ids.add(action.id);
			return {
				ids: inOrder(ids, action.order),
				anchor: action.id,
			};
		}
		case "add":
		{
			const last = action.ids.at(-1);
			if (last === undefined) return state;
			return {
				ids: inOrder(new Set([...state.ids, ...action.ids]), action.order),
				anchor: last,
			};
		}
		case "set":
		{
			const ids = inOrder(new Set(action.ids), action.order);
			const last = ids.at(-1);
			if (last === undefined) return EMPTY_SELECTION;
			return {
				ids,
				anchor: last,
			};
		}
		case "extend":
		{
			const anchor = state.anchor ?? action.focusedId;
			const from = anchor === null ? -1 : action.order.indexOf(anchor);
			const to = action.order.indexOf(action.id);
			if (from === -1 || to === -1)
				return {
					ids: [action.id],
					anchor: action.id,
				};
			const [start, end] = from <= to ? [from, to] : [to, from];
			return {
				ids: action.order.slice(start, end + 1),
				anchor,
			};
		}
		default:
			return assertNever(action);
	}
}

/** The selected rows still shown, in display order. */
export function visibleSelection(state: SidebarSelection, order: readonly string[]): string[]
{
	const ids = new Set(state.ids);
	return order.filter((id) => ids.has(id));
}
