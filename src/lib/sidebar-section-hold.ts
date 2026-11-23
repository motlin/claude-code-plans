import {truncates} from "./session-groups";

/**
 * Upstream's sidebar section hold (`tQ` → `B5` → `hk`): while a sidebar menu is open or one of a section's rows has
 * focus, a truncated section keeps showing every row it showed before, so no row in use drops behind Show more.
 * Rows still re-sort live inside the section.
 */
interface KeyedRow
{
	sessionId: string;
}

export interface SectionViewInput<Row extends KeyedRow>
{
	/** The context epoch (grouping and filters) plus the Show less count; a new one drops the baseline. */
	epoch: string;
	/** `${sortBy}:${direction}`. */
	order: string;
	/** The open menu is Group and sort. */
	sortMenuOpen: boolean;
	sorted: readonly Row[];
	truncateAt: number;
	extraRevealed: number;
	focusedRowKey: string | null;
	menuOpen: boolean;
}

export interface SectionView<Row extends KeyedRow>
{
	epoch: string;
	order: string;
	sorted: readonly Row[];
	truncateAt: number;
	extraRevealed: number;
	visible: readonly Row[];
	hiddenCount: number;
	holding: boolean;
	focusHeld: boolean;
	/** The rows of the last unheld view; holding never grows it. */
	baseline: ReadonlySet<string>;
}

interface Truncation<Row>
{
	visible: readonly Row[];
	hiddenCount: number;
}

interface Held<Row> extends Truncation<Row>
{
	holding: boolean;
	byFocus: boolean;
}

/** Upstream `E$`: the plain truncation. */
function truncateRows<Row>(sorted: readonly Row[], truncateAt: number, extraRevealed: number): Truncation<Row>
{
	if (!truncates(sorted.length, truncateAt, extraRevealed))
		return {
			visible: sorted,
			hiddenCount: 0,
		};
	const shown = truncateAt + extraRevealed;
	return {
		visible: sorted.slice(0, shown),
		hiddenCount: sorted.length - shown,
	};
}

/**
 * Upstream `hk`: with a menu open or a section row focused, the plain truncation plus every baseline row and the
 * focused row, in sorted order.
 */
function holdRows<Row extends KeyedRow>({
	sorted,
	truncateAt,
	extraRevealed,
	baseline,
	focusedRowKey,
	menuOpen,
}: {
	sorted: readonly Row[];
	truncateAt: number;
	extraRevealed: number;
	baseline: ReadonlySet<string> | null;
	focusedRowKey: string | null;
	menuOpen: boolean;
}): Held<Row>
{
	const plain = truncateRows(sorted, truncateAt, extraRevealed);
	const unheld =
	{
		...plain,
		holding: false,
		byFocus: false,
	};
	if (plain.hiddenCount === 0 || baseline === null) return unheld;
	const byFocus = focusedRowKey !== null && sorted.some((row) => row.sessionId === focusedRowKey);
	if (!(menuOpen || byFocus)) return unheld;
	const visible = sorted.filter(
		(row, index) => index < plain.visible.length || baseline.has(row.sessionId) || row.sessionId === focusedRowKey,
	);
	return {
		visible,
		hiddenCount: sorted.length - visible.length,
		holding: true,
		byFocus,
	};
}

/**
 * Upstream `gy`: after a focus hold releases, how far past the first page to reveal so the rows shown before stay,
 * skipping at most `truncateAt` rows that weren't shown.
 */
export function adoptShownCount(
	sorted: readonly KeyedRow[],
	truncateAt: number,
	extraRevealed: number,
	shownKeys: ReadonlySet<string>,
): number
{
	if (!truncates(sorted.length, truncateAt, extraRevealed)) return extraRevealed;
	let through = truncateAt + extraRevealed;
	let skipped = 0;
	for (let index = through; index < sorted.length; index++)
	{
		if (shownKeys.has(sorted[index]?.sessionId ?? "")) through = index + 1;
		else if (skipped === truncateAt) break;
		else skipped++;
	}
	return through - truncateAt;
}

/**
 * Upstream `B7`: how many held rows already show past the cutoff (`shown`), in order, so Show more reveals
 * `truncateAt` rows not yet seen.
 */
export function revealStep<Row>(
	sorted: readonly Row[],
	visible: readonly Row[],
	truncateAt: number,
	shown: number,
): number
{
	let held = 0;
	for (let index = shown; index < sorted.length; index++)
	{
		if (visible[shown + held] === sorted[index]) held++;
		else if (index - shown - held === truncateAt) break;
	}
	return held;
}

/** Upstream `mm`. */
function sameRows<Row>(first: readonly Row[], second: readonly Row[]): boolean
{
	return first.length === second.length && first.every((row, index) => row === second[index]);
}

function keysOf(rows: readonly KeyedRow[]): Set<string>
{
	return new Set(rows.map((row) => row.sessionId));
}

/** Upstream `B5`: the next section view from the input and the previous view (derived state). */
export function reduceSectionView<Row extends KeyedRow>(
	input: SectionViewInput<Row>,
	previous: SectionView<Row> | null,
): SectionView<Row>
{
	const {epoch, sorted, truncateAt} = input;
	const prev = previous?.epoch === epoch ? previous : null;
	const orderChanged = prev !== null && prev.order !== input.order;
	const sortRelease = orderChanged && input.sortMenuOpen;
	// A count adopted at a focus release (upstream `gy`) persists into the group only after commit, so carry it until
	// then; Show less starts a new epoch.
	const extraRevealed =
		prev === null || sortRelease ? input.extraRevealed : Math.max(input.extraRevealed, prev.extraRevealed);
	if (prev?.sorted === sorted && prev.truncateAt === truncateAt && prev.extraRevealed === extraRevealed)
	{
		const kept =
			prev.holding && !prev.focusHeld && input.focusedRowKey !== null
				?
					{
						...prev,
						focusHeld: true,
					}
				: prev;
		return orderChanged
			?
				{
					...kept,
					order: input.order,
				}
			: kept;
	}
	const baseline = prev?.baseline ?? null;
	let held = holdRows(
		{
			sorted,
			truncateAt,
			extraRevealed,
			baseline,
			focusedRowKey: input.focusedRowKey,
			menuOpen: input.menuOpen && !sortRelease,
		},
	);
	let revealed = extraRevealed;
	if (prev !== null && prev.focusHeld && !held.holding && !sortRelease)
	{
		const adopted = adoptShownCount(
			sorted,
			truncateAt,
			Math.min(extraRevealed, prev.extraRevealed),
			keysOf(prev.visible),
		);
		revealed = Math.max(extraRevealed, adopted);
		if (revealed > extraRevealed)
		{
			held =
			{
				...truncateRows(sorted, truncateAt, revealed),
				holding: false,
				byFocus: false,
			};
		}
	}
	const visible = prev !== null && sameRows(prev.visible, held.visible) ? prev.visible : held.visible;
	if (
		prev !== null &&
		!orderChanged &&
		visible === prev.visible &&
		held.hiddenCount === 0 &&
		!held.holding &&
		prev.hiddenCount === 0 &&
		!prev.holding
	)
		return prev;
	return {
		epoch,
		order: input.order,
		sorted,
		truncateAt,
		extraRevealed: revealed,
		visible,
		hiddenCount: held.hiddenCount,
		holding: held.holding,
		focusHeld: held.byFocus || (held.holding && prev?.focusHeld === true),
		baseline: held.holding && baseline !== null ? baseline : keysOf(visible),
	};
}
