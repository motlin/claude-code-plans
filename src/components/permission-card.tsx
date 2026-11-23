import
{
	Fragment,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type ReactElement,
	type ReactNode,
	type RefObject,
} from "react";

import {useIsMac} from "../hooks/use-is-mac";
import {assertNever} from "../lib/assert-never";
import {useReadGate} from "../hooks/use-read-gate";
import {useRowsReadGate} from "../hooks/use-rows-read-gate";
import
{
	acknowledgeApproval,
	clearApprovalAnswered,
	markApprovalAnswered,
	useApprovalAnswered,
} from "../lib/answered-approvals";
import {holdAnswered, releaseAnswered} from "../lib/answered-sessions";
import {approvalEnterSeen, markApprovalEnterSeen} from "../lib/approval-enter-seen";
import {installLandingKeys, justRefocused, landingAllowsPick, trackWindowFocus} from "../lib/approval-slot-landing";
import {buttonDigit, type DigitEntry, digitLayoutKey, permissionDigitEntries} from "../lib/approval-digits";
import {ApprovalPaintSentinel} from "./approval-paint-sentinel";
import
{
	APPROVAL_ARM_GRACE_MS,
	approvalHotkeyFocusAllowed,
	elementOffscreen,
	isIdleComposer,
	onScreen,
} from "../lib/dock-keys";
import {isInKeystrokeSink} from "../lib/shortcuts/match";
import {storeLeadingAllow, useLeadingAllow} from "../lib/approval-leading-allow";
import
{
	type DetailReadGate,
	type FileChangeKind,
	permissionDecisionForKey,
	type PermissionDecision,
	type PermissionDetailLang,
	type PermissionFold,
	type PermissionTitle,
	permissionCardLabel,
	ROWS_READ_HINT,
	titleReadText,
	titleReadWatched,
} from "../lib/permission-card";
import
{
	APPROVAL_READ_ROWS_ATTR,
	cardReadLines,
	createReadLatch,
	lineSeen,
	type ReadGateState,
	readLinesSeen,
	watchReadGate,
	windowOf,
} from "../lib/read-gate";
import type {PermissionDialogShape} from "../lib/herdr/permission-screen";
import {allowMenuItems, AUTO_SWITCH_DESCRIPTION, AUTO_SWITCH_LABEL} from "../lib/permission-auto-switch";
import type {PermissionRow} from "../lib/permission-rows";
import {toAriaKeyShortcuts} from "../lib/shortcuts/format";
import
{
	PERSISTENT_ALLOW_LABEL,
	PERSISTENT_ALLOW_SCOPE,
	type PersistentAllowKind,
	type PersistentAllowSave,
} from "../lib/permission-suggestions";
import {revealSpoofing, visibleSingleLine} from "../lib/visible-text";
import {useBackgroundTasksOpener} from "./background-tasks-opener-context";
import {APPROVAL_ACTION_SHORTCUT_CLASS, ApprovalActionButton} from "./approval-action-button";
import {APPROVAL_SENDING_LABEL, ApprovalCardShell, ApprovalScrollRegion} from "./approval-card";
import {CommandCodeTile} from "./code-tile";
import {LinedScript} from "./lined-script";
import {PermissionFileChangePreview} from "./permission-file-change-body";
import {PermissionRowsList, PERMISSION_ROWS_LABEL} from "./permission-rows";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import * as Collapsible from "./ui/collapsible";
import {DisabledReason} from "./ui/disabled-reason";
import {Shortcut} from "./ui/shortcut";
import {type SplitItem, SplitDropdownButton} from "./ui/split-dropdown-button";

/** Upstream's "Allow and switch to Auto" (cc32965c2 `ei`/`$i`): whether it is offered, and the press. */
export interface PermissionAutoSwitch
{
	offered: boolean;
	/** Allows the tool and switches the session to Auto; a rejection brings the card back with its message. */
	onAllowAndSwitch: () => Promise<void>;
}

/** What the card is sending: a dialog decision, or upstream's allow-and-switch-to-Auto. */
type SentAnswer = PermissionDecision | "allowAuto";

/** Upstream's title gate store (`dr`): read or not, whether it has hinted, and whether the unread part is above. */
interface TitleGate
{
	state: "unread" | "read";
	hinted: boolean;
	upward: boolean;
}

/** Upstream's detail/rows gate store (`J`), keyed by what it gates; `fits` latches to false once it overflowed. */
interface GateRead
{
	key: string;
	state: ReadGateState;
	hinted: boolean;
	fits?: boolean;
}

/**
 * The tool-permission card, drawn inline as claude.ai/code's approvals:
 * "Allow Claude to <action> <meta>?" in a tinted title band, the detail block, and [Deny] then the allow
 * group [Allow once ⌘⏎]. When the CLI's dialog offers a persistent option, the allow group is a
 * primary split button that leads with upstream's stored preference: the persistent option ("Always allow",
 * with no scope tip, as upstream's web card) with Allow once in the menu, or the reverse. Picking the
 * non-leading option from the menu makes it the lead for the next card. The body then lists what
 * "Always allow" adds, as upstream's web saves block.
 * Upstream's keys (Esc deny, ⌘⏎ allow once, ⇧⌘⏎ the persistent option) and digits 1 (Deny) and 2 (Allow once; 3 when
 * a persistent option is offered, whose own digit 2 does nothing), with no keycaps inline.
 * A decision hides the card at once, with no busy state; a failed answer brings it back with the error.
 * With `sessionId` and `answerKey` the decision also marks the prompt answered for every view,
 * so a remount of the same prompt stays hidden until the mark clears on a failed answer.
 * With `hideOnDecision` false the card stays until its parent drops it: the chosen action busy ("Sending…")
 * and the others disabled, as upstream's held form and link cards.
 * A live arrival fades in over 160ms; a remount or reload of the same prompt (`enterKey`) does not.
 * With `dialog`, the terminal's dialog shapes the card as upstream's ask flags do: a deny-first dialog,
 * or one whose shape is still unknown (upstream's askFlagsUnknown), draws upstream's defaultToNo card
 * (Deny primary, Allow once secondary, no keys, no persistent option); a dialog with no persistent row
 * drops the hook's persistent option.
 * With `autoSwitch` offered, "More allow options" ends with upstream's "Allow and switch to Auto" row; with no
 * persistent option it makes Allow once a split button holding that row alone. The row is latched as the card
 * first paints with its dialog read, so it never appears or vanishes under the pointer.
 */
export function PermissionCard({
	title,
	detail,
	detailLang = null,
	clampTitle = false,
	detailIsPath = false,
	detailNote = null,
	description = null,
	tokenWarning = false,
	detailFirst = false,
	rows = null,
	rowsTrail = false,
	rowsGate = false,
	rowsGateStrict = false,
	detailReadGate = null,
	perUseOnly = false,
	clickOnly = false,
	fileChange = null,
	folds = null,
	toolName = null,
	toolInput = null,
	canAnswer,
	persistentAllow: hookPersistentAllow = null,
	persistentAllowSaves = null,
	dialog,
	autoSwitch = null,
	onDecision,
	footer,
	enterKey,
	sessionId,
	answerKey,
	hideOnDecision = true,
	presentation = "card",
	queueDepth = 0,
}: {
	title: PermissionTitle;
	detail: string | null;
	/** A command detail's language: drawn as upstream's highlighted code card with a `$ ` gutter. */
	detailLang?: PermissionDetailLang | null;
	/** Upstream's `clampTitle`: the title value is clamped to two lines. */
	clampTitle?: boolean;
	/** Upstream's `detailIsPath`: the detail is a path, drawn left-to-right through `PathDetailLines`. */
	detailIsPath?: boolean;
	/** Upstream's footnote under the detail ("Keeps running in the background."). */
	detailNote?: string | null;
	/** The description line: a Bash command's, an agent's or a Workflow's. */
	description?: string | null;
	/** Upstream's Workflow callout about usage, linking the Background tasks pane. */
	tokenWarning?: boolean;
	/** Upstream's `detailFirst`: the detail leads the body (Grep's pattern, WebFetch's url). */
	detailFirst?: boolean;
	/** Upstream's input rows: the tool call's other input as key/value rows. */
	rows?: readonly PermissionRow[] | null;
	/** Upstream's `rowsTrail`: the rows close the body in the tinted "What Claude sent" panel. */
	rowsTrail?: boolean;
	/** Upstream's loose rows read gate: Allow waits until a trail panel that scrolls has been read to its end. */
	rowsGate?: boolean;
	/** The rows gate is strict: enforced even when the rows fit. */
	rowsGateStrict?: boolean;
	/** Upstream's `detailReadGate`: the detail is capped to six lines and Allow waits until all of it was seen. */
	detailReadGate?: DetailReadGate | null;
	/** Upstream's `disableAlwaysAllow`: the persistent option is never offered. */
	perUseOnly?: boolean;
	/** Upstream's `clickOnly`: the card binds no keys. */
	clickOnly?: boolean;
	/** Upstream's `fileChange`: a Write/Edit/MultiEdit card draws its change, or says it is too large to. */
	fileChange?: FileChangeKind | null;
	/** Upstream's `foldedDetail`: disclosures closing the detail slot, such as NotebookEdit's "New cell content". */
	folds?: readonly PermissionFold[] | null;
	/** The previewed file tool's name, for its diff. */
	toolName?: string | null;
	/** The previewed file tool's input, for its diff. */
	toolInput?: Record<string, unknown> | null;
	/** False without a live herdr pane that accepts writes. */
	canAnswer: boolean;
	/** The dialog's persistent allow option, from the PermissionRequest hook; null hides it. */
	persistentAllow?: PersistentAllowKind | null;
	/** What the persistent option adds, listed in the body while it is offered; null lists nothing. */
	persistentAllowSaves?: readonly PersistentAllowSave[] | null;
	/**
	 * The shape of the terminal's dialog, or "unknown" until it is read; undefined keeps the hook's card
	 * (no dialog to read, as an elicitation's).
	 */
	dialog?: PermissionDialogShape | "unknown" | undefined;
	/** Upstream's "Allow and switch to Auto" row; null never offers it. */
	autoSwitch?: PermissionAutoSwitch | null;
	onDecision: (decision: PermissionDecision) => Promise<void>;
	/** Rendered under the actions; the session page passes the notify tip. */
	footer?: ReactNode;
	/** The prompt's notification id: it fades in only the first time this tab draws it. */
	enterKey?: string | undefined;
	/** The prompt's session, for the answered-approvals mark. */
	sessionId?: string | undefined;
	/** The prompt's answer key (its tool call, else its notification id), marked answered on a decision. */
	answerKey?: string | undefined;
	/**
	 * False keeps the card up, its chosen action busy, after a decision: an elicitation's card
	 * is cleared by its `ElicitationResult`, since the CLI can refuse an early Enter.
	 */
	hideOnDecision?: boolean;
	/** Upstream's approval presentation: the inline "card" or the composer "dock"; a change re-measures every gate. */
	presentation?: "card" | "dock";
	/** Upstream's `queueDepth`: the other requests pending behind this one, drawn as ghosts while docked. */
	queueDepth?: number;
})
{
	const isMac = useIsMac();
	const [enter] = useState(() => enterKey === undefined || !approvalEnterSeen(enterKey));
	useEffect(() =>
	{
		if (enterKey !== undefined) markApprovalEnterSeen(enterKey);
	}, [enterKey]);
	const [sent, setSent] = useState<SentAnswer | null>(null);
	const decided = sent !== null;
	const [error, setError] = useState<string | null>(null);
	// An elicitation's card stays up after a decision, so only a hiding card marks its prompt answered.
	const markSession = hideOnDecision ? sessionId : undefined;
	const markKey = markSession === undefined ? undefined : answerKey;
	const answered = useApprovalAnswered(markSession ?? "", markKey ?? null);
	const enabled = canAnswer && !decided && !answered;
	// Upstream's `hn`/`vn`: a defaultToNo (or askFlagsUnknown) card leads with Deny and binds no keys.
	const denyFirst = dialog === "unknown" || dialog?.denyFirst === true;
	const persistentAllow = denyFirst || perUseOnly || dialog?.persistent === false ? null : hookPersistentAllow;

	const decideWith = useCallback(
		async (answer: SentAnswer, send: () => Promise<void>) =>
		{
			setError(null);
			setSent(answer);
			if (markSession !== undefined && markKey !== undefined) markApprovalAnswered(markSession, markKey);
			if (sessionId !== undefined && answerKey !== undefined) holdAnswered(sessionId, answerKey);
			try
			{
				await send();
				// The card carries no tool name, and nothing reads the stored one.
				if (markSession !== undefined && markKey !== undefined) acknowledgeApproval(markSession, markKey, "");
			}
			catch (err)
			{
				if (markSession !== undefined && markKey !== undefined) clearApprovalAnswered(markSession, markKey);
				if (sessionId !== undefined) releaseAnswered(sessionId);
				setError(err instanceof Error ? err.message : "Failed to answer the permission request");
				setSent(null);
			}
		},
		[markSession, markKey, sessionId, answerKey],
	);
	const decide = useCallback(
		async (decision: PermissionDecision) => decideWith(decision, async () => onDecision(decision)),
		[decideWith, onDecision],
	);

	// Upstream's painted id (`Zn`), set by the paint sentinel: until the card has drawn two visible frames, and again
	// while it is hidden, every allow is held (`gr()`), and painting re-arms the hotkeys' grace (the arm key `$n`).
	const [painted, setPainted] = useState(false);
	const onPainted = useCallback(() =>
	{
		setPainted(true);
	}, []);
	const onUnpainted = useCallback(() =>
	{
		setPainted(false);
	}, []);

	// Upstream's paint latch (`si`/`ii`): the offer is read once the dialog's shape is known, then kept.
	const [autoLatched, setAutoLatched] = useState<boolean | null>(null);
	if (autoLatched === null && dialog !== "unknown") setAutoLatched(autoSwitch?.offered === true);
	const mountedAtRef = useRef<number | null>(null);
	useEffect(() =>
	{
		mountedAtRef.current = performance.now();
	}, []);
	// Upstream's `$i`: swallowed within the arm grace, as the hotkeys are.
	const allowAndSwitch = () =>
	{
		const mountedAt = mountedAtRef.current ?? performance.now();
		if (autoSwitch === null || !painted || performance.now() - mountedAt < APPROVAL_ARM_GRACE_MS) return;
		void decideWith("allowAuto", autoSwitch.onAllowAndSwitch);
	};

	const lead = useLeadingAllow();
	// Upstream's `ui`: picking the non-leading option from the menu makes it the lead.
	const allowOnceFromMenu = () =>
	{
		storeLeadingAllow("once");
		void decide("allow");
	};
	const persistentFromMenu = () =>
	{
		storeLeadingAllow("always");
		void decide("always");
	};

	// Upstream's title gate (`yw` + `hr`): an inline card's title band must be seen from its head to its end.
	const titleRef = useRef<HTMLDivElement>(null);
	const titleWatched = titleReadWatched(
		{
			title,
			clampTitle,
			hasDetail: detail !== null,
		},
	);
	const [titleGate, setTitleGate] = useState<TitleGate | null>(null);
	const onTitleHeld = useCallback((held: boolean, quiet = false, upward = false) =>
	{
		setTitleGate((previous) =>
		{
			if (previous === null && !held) return previous;
			const next: TitleGate =
			{
				state: held ? "unread" : "read",
				hinted: previous?.hinted === true || (held && !quiet),
				upward: held ? upward : previous?.upward === true,
			};
			return previous?.state === next.state && previous.hinted === next.hinted && previous.upward === next.upward
				? previous
				: next;
		});
	}, []);
	useReadGate(
		{
			ref: titleRef,
			watched: titleWatched,
			text: titleReadText(title),
			hostClips: presentation === "card",
			presentation,
			onHeld: onTitleHeld,
		},
	);

	// Upstream's detail and rows gates (`kC`/`jC`) share one store (`J`), keyed by what they gate and reset when the
	// presentation changes (`Ur`).
	const rowsPanelRef = useRef<HTMLDivElement>(null);
	const hasRows = rows !== null && rows.length > 0;
	const detailGated = detailReadGate !== null && detail !== null;
	const rowsGated = rowsGate && rowsTrail && hasRows && !detailGated;
	const gateKey = detailGated
		? `${presentation}\n${detail}\n\n${detailNote ?? ""}\n`
		: rowsGated
			? `${presentation}\nrows\n${JSON.stringify(rows)}`
			: null;
	const [gate, setGate] = useState<GateRead | null>(null);
	const onGateRead = useCallback(
		(state: ReadGateState) =>
		{
			if (gateKey === null) return;
			setGate((previous) =>
			{
				const known = previous?.key === gateKey ? previous : undefined;
				if (known?.state === state || (known !== undefined && state === "unlaid")) return previous;
				return {
					key: gateKey,
					state,
					hinted: known?.hinted === true || state === "unread",
					...(known?.fits === undefined
						? {}
						:
							{
								fits: known.fits,
							}),
				};
			});
		},
		[gateKey],
	);
	// Upstream's `wr`: once the body overflowed, a loose gate stays enforced until read, even if it later fits.
	const onGateFits = useCallback(
		(reported: boolean) =>
		{
			setGate((previous) =>
			{
				if (gateKey === null || previous?.key !== gateKey || previous.state === "read") return previous;
				const fits = previous.fits !== false && reported;
				return fits === previous.fits
					? previous
					:
						{
							...previous,
							fits,
						};
			});
		},
		[gateKey],
	);
	useRowsReadGate(
		{
			ref: rowsPanelRef,
			watched: rowsGated,
			gateKey: gateKey ?? "",
			onReadState: onGateRead,
			onFits: onGateFits,
		},
	);
	const gateRead = gate?.key === gateKey ? gate : undefined;
	const titleHinted = titleGate?.hinted === true;
	const titleUnread = titleHinted && titleGate.state !== "read";
	const otherUnread = gateKey !== null && gateRead?.state !== "read";
	// Upstream's `Er`: the title, a detail gate and a strict rows gate always enforce; a loose one only once the body
	// overflowed or before it has a layout.
	const enforced =
		titleHinted ||
		(gateKey !== null &&
			(!rowsGated || rowsGateStrict || gateRead?.fits === false || gateRead?.state === "unlaid"));
	const readHeld = (titleUnread || otherUnread) && enforced;
	// Upstream's `Or`: an allow is refused while any gate is unread, enforced or not.
	const readBlocked = readHeld || titleGate?.state === "unread" || otherUnread;
	// Upstream's `Ir`: the detail or rows hint while that gate is unread, the title's once only it is.
	const otherHint = detailGated ? detailReadGate.hint : rowsGated ? ROWS_READ_HINT : undefined;
	const titleHint = titleGate?.upward === true ? TITLE_UP_HINT : TITLE_READ_HINT;
	const shownHint = titleHinted && (titleUnread ? !otherUnread : otherHint === undefined) ? titleHint : otherHint;
	const [heldAttempts, setHeldAttempts] = useState(0);
	const onHeldAttempt = useCallback(() =>
	{
		setHeldAttempts((count) => count + 1);
	}, []);
	// Upstream's `Kr`: the hint mounts once an enforced gate hinted, on an inline card not laid out yet, or after an
	// attempt; the hinted marks latch, so it stays (invisible once read) and the card doesn't jump.
	const hintMounted =
		titleHinted ||
		(enforced &&
			gateRead !== undefined &&
			(gateRead.hinted || (presentation === "card" && gateRead.state === "unlaid"))) ||
		heldAttempts > 0;
	const gated = titleWatched || gateKey !== null;
	/** Upstream's `Xr`: an allow while a read gate is unread is refused and counted as an attempt. */
	const allowed = (run: () => void) => () =>
	{
		if (readBlocked)
		{
			onHeldAttempt();
			return;
		}
		// Upstream's `gr()` also holds an unpainted card's allow, silently: the button doesn't look disabled.
		if (!painted) return;
		run();
	};

	const cardRootRef = useRef<HTMLDivElement>(null);
	usePermissionHotkeys(
		cardRootRef,
		{
			enabled: enabled && !denyFirst && !clickOnly,
			painted,
			persistent: persistentAllow !== null,
			held: readBlocked,
			onceLive: !readHeld,
			persistentLive: !readHeld,
			onHeldAttempt,
			decide,
		},
	);
	// Upstream's `digitsEnabled` (`enableDigitShortcuts && !bn`): no digits on a deny-first or click-only card.
	const digitsLive = canAnswer && !denyFirst && !clickOnly;
	const digitEntries = permissionDigitEntries(
		{
			persistentOffered: persistentAllow !== null,
			allowDisabled: !enabled || readHeld,
			denyDisabled: !enabled,
		},
	);
	usePermissionDigitKeys(
		cardRootRef,
		{
			live: digitsLive,
			painted,
			entries: digitEntries,
			act: (entry) =>
			{
				if (entry === "deny") void decide("deny");
				else if (entry === "once") allowed(() => void decide("allow"))();
			},
		},
	);

	if ((decided || answered) && hideOnDecision) return null;

	const pathDetail = (path: string) => (
		<div data-permission-detail data-approval-value className={DETAIL_CLASS} dir={detailIsPath ? "ltr" : undefined}>
			{detailIsPath ? <PathDetailLines path={path} /> : path}
		</div>
	);
	/** Upstream's `a(note)` for a previewed change: the path, grouped with its note when there is one. */
	const drawFileDetail = (note: string | null) =>
		detail === null ? null : note === null ? (
			pathDetail(detail)
		) : (
			<div className="flex flex-col gap-[12px]">
				{pathDetail(detail)}
				<p data-testid="approval-detail-note" className={DETAIL_NOTE_CLASS}>
					{note}
				</p>
			</div>
		);
	const foldsBlock =
		folds !== null && folds.length > 0 ? (
			<div data-testid="approval-folds" className="flex flex-col gap-1">
				{folds.map((fold, index) => (
					// oxlint-disable-next-line react/no-array-index-key -- the folds are fixed for one request
					<PermissionFoldView key={index} fold={fold} />
				))}
			</div>
		) : null;
	const previews = fileChange === "preview" && toolName !== null && toolInput !== null;
	const detailBlock = previews ? (
		<div className="flow-root">
			<div data-approval-value className="flex flex-col gap-md">
				<PermissionFileChangePreview
					toolName={toolName}
					toolInput={toolInput}
					copyNote={detailNote}
					drawDetail={drawFileDetail}
				/>
			</div>
		</div>
	) : detailGated ? (
		// Upstream's `VC`, keyed by what it gates so a changed command starts unread.
		<div data-permission-detail className="flow-root">
			<CommandReadGate
				key={gateKey}
				label={detailReadGate.label}
				note={detailNote}
				read={gateRead?.state === "read"}
				onReadState={onGateRead}
			>
				{detail}
			</CommandReadGate>
		</div>
	) : detailLang === null ? (
		// Upstream's `a(t)` slot: the path grouped with its note, then the folds, flush in one flow-root.
		(detail !== null || foldsBlock !== null) && (
			<div className="flow-root">
				{drawFileDetail(detailNote)}
				{foldsBlock}
			</div>
		)
	) : (
		<>
			{detail !== null && (
				<div data-permission-detail className="flow-root">
					<div data-approval-value>
						<div className="contents" dir="ltr">
							<CommandCodeTile command={detail} lang={detailLang} />
						</div>
					</div>
				</div>
			)}
			{detailNote !== null && <p className={DETAIL_NOTE_CLASS}>{detailNote}</p>}
		</>
	);
	/** The allow buttons' disabled reason while a read gate holds them. */
	const allowReason = readHeld ? (shownHint ?? null) : null;
	// Upstream hides the row while the read gate is unmet (`!lr`), and draws none on a deny-first or click-only card.
	const autoOffered = autoLatched === true && !readHeld && !denyFirst && !clickOnly;
	// Upstream's `Zr`: the persistent option's scope, dropped once the saves block lists what it adds (`Bn`).
	const scopeTooltip = persistentAllowSaves === null ? PERSISTENT_ALLOW_SCOPE : undefined;
	const menuItems = allowMenuItems(
		{
			persistent: persistentAllow !== null,
			lead,
			autoOffered,
		},
	).map((item): SplitItem =>
	{
		switch (item)
		{
			case "once":
				return {
					label: "Allow once",
					shortcut: "cmd+enter",
					onSelect: allowed(allowOnceFromMenu),
				};
			case "persistent":
				return scopeTooltip === undefined
					?
						{
							label: PERSISTENT_ALLOW_LABEL,
							onSelect: allowed(persistentFromMenu),
						}
					:
						{
							label: PERSISTENT_ALLOW_LABEL,
							description: scopeTooltip,
							onSelect: allowed(persistentFromMenu),
						};
			case "auto":
				return {
					label: AUTO_SWITCH_LABEL,
					description: AUTO_SWITCH_DESCRIPTION,
					onSelect: allowed(allowAndSwitch),
				};
			default:
				return assertNever(item);
		}
	});
	const leadsAlways = persistentAllow !== null && lead === "always";
	const withAllowReason = (control: ReactElement) =>
		gated ? <DisabledReason reason={allowReason}>{control}</DisabledReason> : control;

	return (
		<ApprovalCardShell
			rootRef={cardRootRef}
			label={permissionCardLabel(title)}
			{...(digitsLive
				?
					{
						digits: digitEntries.length,
					}
				: {})}
			footer={footer}
			presentation={presentation}
			toolCard
			queueDepth={queueDepth}
			enter={enter}
			titleRef={titleRef}
			title={
				<div className="text-primary min-h-[24px] shrink-0 flex items-center gap-1">
					<span className="flex flex-1 min-w-0 flex-col gap-[2px]">
						<span className="flex items-start gap-xs min-w-0">
							<span
								data-permission-title
								data-approval-card-title
								className="text-body min-w-0 break-words"
							>
								<PermissionTitleText title={title} clamp={clampTitle} />
							</span>
						</span>
					</span>
				</div>
			}
			body={
				<>
					<div className="flex flex-col gap-[12px] empty:hidden">
						{detailFirst && detailBlock}
						{description !== null && (
							<ApprovalScrollRegion
								label="Description"
								className={
									presentation === "card" && detailGated
										? DESCRIPTION_READ_GATED_CLASS
										: DESCRIPTION_CLASS
								}
							>
								{description}
							</ApprovalScrollRegion>
						)}
						{!rowsTrail && hasRows && <PermissionRowsList rows={rows} />}
						{persistentAllow !== null && persistentAllowSaves !== null && (
							<AlwaysAllowSaves saves={persistentAllowSaves} />
						)}
						{fileChange === "too_large" && <p className={TOO_LARGE_CLASS}>{FILE_CHANGE_TOO_LARGE}</p>}
						{tokenWarning && <TokenWarning />}
						{rowsTrail &&
							hasRows &&
							(rowsGated ? (
								// Upstream's `E` wrapper, keyed by the rows so new rows start unread.
								<div
									ref={rowsPanelRef}
									key={gateKey}
									data-testid="approval-read-rows"
									{...
									{
										[APPROVAL_READ_ROWS_ATTR]: "",
									}}
								>
									{/* A gated panel never clamps; its groups fold only once a scrolled panel is read. */}
									<RowsPanel
										rows={rows}
										foldable={gateRead?.fits === false && gateRead.state === "read"}
										clamp={false}
									/>
								</div>
							) : (
								<RowsPanel rows={rows} foldable clamp />
							))}
						{/* Upstream's `Le`: a detail that doesn't lead closes the body, after the token warning and trail rows. */}
						{!detailFirst && detailBlock}
						{!canAnswer && <ReadOnlyAnswerHint className="text-footnote text-secondary" />}
						{error && <p className="text-footnote text-extended-pink">{error}</p>}
					</div>
					{/* Upstream's `lS`, keyed by the placement: it watches the body wrapper. */}
					<ApprovalPaintSentinel key={presentation} onPainted={onPainted} onUnpainted={onUnpainted} />
				</>
			}
			note={
				gated ? (
					<>
						{/* Upstream's re-announcing live region: a trailing NBSP on even attempts. */}
						<p aria-live="polite" className="sr-only">
							{readBlocked && heldAttempts > 0 && shownHint !== undefined
								? `${shownHint}${heldAttempts % 2 === 0 ? " " : ""}`
								: ""}
						</p>
						{hintMounted && shownHint !== undefined && (
							<p
								aria-hidden
								data-testid="approval-read-hint"
								className={`${READ_HINT_CLASS}${readHeld ? "" : " invisible"}`}
							>
								{shownHint}
							</p>
						)}
					</>
				) : undefined
			}
			actions={
				<>
					<span className="contents">
						<ApprovalActionButton
							variant={denyFirst ? "primary" : "secondary"}
							{...(denyFirst
								?
									{
										"data-approval-primary": "",
									}
								:
									{
										"aria-keyshortcuts": "Escape",
									})}
							busy={sent === "deny"}
							busyLabel={APPROVAL_SENDING_LABEL}
							disabled={!enabled && sent !== "deny"}
							onClick={() => void decide("deny")}
						>
							<span className="min-w-0 [unicode-bidi:plaintext] truncate" data-approval-digit="1">
								Deny
							</span>
						</ApprovalActionButton>
					</span>
					<div data-approval-allow className="flex min-w-0 flex-wrap items-start gap-sm">
						{denyFirst ? (
							<ApprovalActionButton
								variant="secondary"
								busy={sent === "allow"}
								busyLabel={APPROVAL_SENDING_LABEL}
								disabled={!enabled && sent !== "allow"}
								onClick={allowed(() => void decide("allow"))}
							>
								<span className="min-w-0 [unicode-bidi:plaintext] truncate" data-approval-digit="2">
									Allow once
								</span>
							</ApprovalActionButton>
						) : menuItems.length === 0 ? (
							withAllowReason(
								<ApprovalActionButton
									variant="primary"
									data-approval-primary=""
									aria-keyshortcuts={toAriaKeyShortcuts("cmd+enter", isMac)}
									busy={sent === "allow"}
									busyLabel={APPROVAL_SENDING_LABEL}
									disabled={(!enabled && sent !== "allow") || readHeld}
									onClick={allowed(() => void decide("allow"))}
								>
									<span className="min-w-0 [unicode-bidi:plaintext] truncate" data-approval-digit="2">
										Allow once
									</span>
									<Shortcut keys="cmd+enter" className={APPROVAL_ACTION_SHORTCUT_CLASS} />
								</ApprovalActionButton>,
							)
						) : (
							withAllowReason(
								<SplitDropdownButton
									variant="primary"
									size="control"
									className="max-w-full min-w-0"
									items={menuItems}
									{...(leadsAlways
										?
											{
												groupLabel: PERSISTENT_ALLOW_LABEL,
												...(scopeTooltip === undefined
													? {}
													:
														{
															tooltip: scopeTooltip,
														}),
												label: (
													<span data-approval-digit="2" data-approval-primary="">
														{PERSISTENT_ALLOW_LABEL}
													</span>
												),
												onPrimaryClick: allowed(() => void decide("always")),
											}
										:
											{
												groupLabel: "Allow once",
												label: (
													<span data-approval-digit="2" data-approval-primary="">
														Allow once
													</span>
												),
												shortcut: "cmd+enter",
												"aria-keyshortcuts": toAriaKeyShortcuts("cmd+enter", isMac),
												onPrimaryClick: allowed(() => void decide("allow")),
											})}
									menuLabel="More allow options"
									busy={sent === "allow" || sent === "always" || sent === "allowAuto"}
									disabled={!enabled || readHeld}
								/>,
							)
						)}
					</div>
				</>
			}
		/>
	);
}

/**
 * Upstream's approval hotkeys (`Jl`) on window in the capture phase. They act with focus in the card,
 * on the page body or in the idle composer, and yield to IME, popups and other fields, and while the card is
 * off-screen. ⌘⏎ also yields to alt and a composer draft. A repeat is swallowed with no action. Within the 400ms arm
 * grace, counted from when the card painted or was re-enabled, ⌘⏎ and ⇧⌘⏎ fall through untouched; Esc has no grace.
 * An unpainted card's allow does nothing, and a chord within 400ms of its option turning live is swallowed, the
 * window sliding to the press. ⇧⌘⏎ needs a persistent option and focus in the card or the composer, and is refused
 * on a card focus landed on (upstream's landing keys, installed ahead of this listener).
 */
function usePermissionHotkeys(
	cardRootRef: RefObject<HTMLDivElement | null>,
	{
		enabled,
		painted,
		persistent,
		held,
		onceLive,
		persistentLive,
		onHeldAttempt,
		decide,
	}:
	{
		enabled: boolean;
		/** The paint sentinel saw the card: until then an allow does nothing, and each paint restarts the grace. */
		painted: boolean;
		persistent: boolean;
		/** A read gate holds the allow decisions: they are swallowed and reported as attempts. */
		held: boolean;
		/** Upstream's `onceLive`: Allow once can act; turning true swallows ⌘⏎ for 400ms. */
		onceLive: boolean;
		/** Upstream's `persistentLive`: the persistent option can act; turning true swallows ⇧⌘⏎ for 400ms. */
		persistentLive: boolean;
		onHeldAttempt: () => void;
		decide: (decision: PermissionDecision) => unknown;
	},
)
{
	// Upstream's `D`: stamped each time the listener installs, which its arm key (painted) and `enabled` drive.
	const armedAtRef = useRef(Number.NEGATIVE_INFINITY);
	useEffect(() =>
	{
		if (enabled) armedAtRef.current = performance.now();
	}, [enabled, painted]);
	// Upstream's `w`/`b`: when Allow once and the persistent option last turned live.
	const onceLiveAtRef = useRef(Number.NEGATIVE_INFINITY);
	useEffect(() =>
	{
		if (onceLive) onceLiveAtRef.current = performance.now();
	}, [onceLive]);
	const persistentLiveAtRef = useRef(Number.NEGATIVE_INFINITY);
	useEffect(() =>
	{
		if (persistentLive) persistentLiveAtRef.current = performance.now();
	}, [persistentLive]);
	useEffect(() =>
	{
		if (!enabled) return undefined;
		// The landing keys go first, so ⇧⌘⏎ on a card focus merely landed on never reaches this listener.
		installLandingKeys(window);
		const onKeyDown = (event: KeyboardEvent) =>
		{
			const card = cardRootRef.current;
			const decision = permissionDecisionForKey(event);
			if (card === null || decision === null) return;
			if (event.isComposing)
			{
				if (decision === "deny") event.stopPropagation();
				return;
			}
			if (!approvalHotkeyFocusAllowed(card) || !onScreen(card)) return;
			const active = document.activeElement;
			if (decision === "allow" && isIdleComposer(active) && active.value !== "") return;
			const now = performance.now();
			// Upstream's `O.current` branch: a chord inside the grace is left to the page, not consumed.
			if (decision !== "deny" && !event.repeat && now - armedAtRef.current < APPROVAL_ARM_GRACE_MS) return;
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) return;
			if (decision === "deny")
			{
				decide(decision);
				return;
			}
			const liveAt = decision === "always" ? persistentLiveAtRef : onceLiveAtRef;
			if (now - liveAt.current < APPROVAL_ARM_GRACE_MS)
			{
				liveAt.current = Math.max(liveAt.current, now);
				return;
			}
			if (decision === "always" && !(persistent && (card.contains(active) || isIdleComposer(active)))) return;
			if (held)
			{
				onHeldAttempt();
				return;
			}
			if (!painted) return;
			decide(decision);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [cardRootRef, enabled, painted, persistent, held, onHeldAttempt, decide]);
}

/** Targets that keep their digits (upstream `Fa` step 5): fields, menus, tabs, a question card, bare-digit owners. */
const DIGIT_FIELD_SELECTOR = [
	"input",
	"select",
	'[role^="menu"]',
	'[role="listbox"]',
	'[role="option"]',
	'[role="tab"]',
	'[role="combobox"]',
	'[role="textbox"]',
	'[role="searchbox"]',
	"[data-owns-bare-digits]",
	'[data-cds="AskUserQuestion"]',
	'[contenteditable]:not([contenteditable="false"])',
].join(",");
/** Open popups and dialogs a digit yields to (upstream's `Rr`). */
const DIGIT_POPUP_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],dialog[open]';
/** Whether the digit's target keeps it: another approval card, a keystroke sink, a field, or a textarea that isn't the idle composer. */
function targetKeepsDigit(target: Element, card: HTMLElement): boolean
{
	const otherCard = target.closest("[data-approval-card-root]");
	if (otherCard !== null && otherCard !== card) return true;
	if (isInKeystrokeSink(target)) return true;
	if (target.closest(DIGIT_FIELD_SELECTOR) !== null) return true;
	return target instanceof HTMLTextAreaElement && !isIdleComposer(target);
}

/** Upstream's `M1`: the card sits under `[inert]` or behind a modal it isn't inside. */
function cardUnderModal(card: HTMLElement): boolean
{
	if (card.closest("[inert]") !== null) return true;
	return [...document.querySelectorAll('[aria-modal="true"]')].some((modal) => !modal.contains(card));
}

function popupOpenOutside(card: HTMLElement): boolean
{
	return [...document.querySelectorAll<HTMLElement>(DIGIT_POPUP_SELECTOR)].some(
		(popup) => !card.contains(popup) && (typeof popup.checkVisibility !== "function" || popup.checkVisibility()),
	);
}

/** The session composer holds a draft. */
function composerHasDraft(): boolean
{
	const composer = document.querySelector<HTMLTextAreaElement>("[data-composer-card] textarea");
	return composer !== null && composer.value !== "";
}

/**
 * Upstream's inline digit keys (shared-3 `Fa`) on window in the capture phase: digit n runs `entries[n-1]`. They yield
 * to IME, chords, modals (restarting the arm), popups, fields and other cards, to a composer draft when focus is outside
 * the card, and while the card is off-screen. The held persistent digit is left alone in the composer and on a card
 * button of another digit. A repeat is swallowed. Within the 400ms arm grace (counted from mount and paint, focus
 * entering the card, and a pointerdown on it) a digit falls through untouched; within a second of the window regaining
 * focus it is swallowed. Otherwise it is consumed, and a non-deny digit within 400ms of the layout changing (a gate
 * releasing) does nothing, the window sliding to the press. On a card focus landed on, only a fresh pick acts.
 */
function usePermissionDigitKeys(
	cardRootRef: RefObject<HTMLDivElement | null>,
	{
		live,
		painted,
		entries,
		act,
	}:
	{
		/** The card takes digits at all (upstream's `digitsEnabled`). */
		live: boolean;
		/** Each paint restarts the arm grace (upstream's paint latch in `armKey`). */
		painted: boolean;
		entries: readonly DigitEntry[];
		act: (entry: DigitEntry) => void;
	},
)
{
	const entriesRef = useRef(entries);
	entriesRef.current = entries;
	const actRef = useRef(act);
	actRef.current = act;
	const armedAtRef = useRef(Number.NEGATIVE_INFINITY);
	useEffect(() =>
	{
		if (live) armedAtRef.current = performance.now();
	}, [live, painted]);
	// Upstream's `rearmKey`: a change of which entries act re-arms the non-deny digits.
	const layout = digitLayoutKey(entries);
	const layoutRef = useRef(layout);
	const rearmAtRef = useRef(Number.NEGATIVE_INFINITY);
	useEffect(() =>
	{
		if (layoutRef.current !== layout) rearmAtRef.current = performance.now();
		layoutRef.current = layout;
	}, [layout]);
	useEffect(() =>
	{
		const card = cardRootRef.current;
		if (!live || card === null) return undefined;
		installLandingKeys(window);
		trackWindowFocus(window);
		const arm = () =>
		{
			armedAtRef.current = performance.now();
		};
		const onFocusIn = (event: FocusEvent) =>
		{
			if (!(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) arm();
		};
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.isComposing || !/^[1-9]$/.test(event.key)) return;
			const index = Number(event.key) - 1;
			const entry = entriesRef.current[index];
			if (entry === undefined) return;
			const now = performance.now();
			if (cardUnderModal(card))
			{
				armedAtRef.current = now;
				return;
			}
			if (popupOpenOutside(card)) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target !== null && targetKeepsDigit(target, card)) return;
			const active = document.activeElement;
			const inComposer = isIdleComposer(target);
			if (
				entry === "held" &&
				(inComposer ||
					(active instanceof HTMLButtonElement &&
						card.contains(active) &&
						buttonDigit(active) !== Number(event.key)))
			)
			{
				return;
			}
			if (!(target !== null && card.contains(target)) && composerHasDraft()) return;
			if (elementOffscreen(card)) return;
			const consume = () =>
			{
				event.preventDefault();
				event.stopImmediatePropagation();
			};
			if (event.repeat)
			{
				consume();
				return;
			}
			if (now - armedAtRef.current < APPROVAL_ARM_GRACE_MS) return;
			if (justRefocused(window) || active instanceof HTMLIFrameElement)
			{
				if (!inComposer) consume();
				return;
			}
			consume();
			if (index !== 0 && now - rearmAtRef.current < APPROVAL_ARM_GRACE_MS)
			{
				rearmAtRef.current = now;
				return;
			}
			if (!landingAllowsPick(event, true)) return;
			actRef.current(entry);
		};
		card.addEventListener("focusin", onFocusIn);
		card.addEventListener("pointerdown", arm);
		window.addEventListener("keydown", onKeyDown, true);
		return () =>
		{
			card.removeEventListener("focusin", onFocusIn);
			card.removeEventListener("pointerdown", arm);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [cardRootRef, live]);
}

/** Upstream's body classes (`epitaxy-code-size` hooks, held at the default size by the card's data-fixed-code-size): the detail block (`Lg`), its footnote (`kg`) and the description line (`Dg`). */
/** Upstream's bidi-control test (`be`, shared-l-p-m-w-0 `FN`). */
const BIDI_CONTROL_RE = /\p{Bidi_Control}/u;

/**
 * Upstream's `Np` line renderer for a path detail: a line holding a bidi control is drawn as a
 * left-to-right isolate-override span with its spoofing characters shown; any other line as itself.
 */
function PathDetailLines({path}: {path: string})
{
	return path.split("\n").map((line, index) => (
		// oxlint-disable-next-line react/no-array-index-key -- the lines are fixed for one path
		<Fragment key={index}>
			{index > 0 && "\n"}
			{BIDI_CONTROL_RE.test(line) ? (
				<span dir="ltr" className="[unicode-bidi:isolate-override]">
					{revealSpoofing(line)}
				</span>
			) : (
				line
			)}
		</Fragment>
	));
}

const DETAIL_CLASS =
	"epitaxy-code-size bg-alpha-1 rounded-r4 py-md px-lg text-code text-secondary whitespace-pre-wrap break-words select-text [unicode-bidi:plaintext]";
/** Upstream's `U` paragraph (`gy`) for a change over the preview cap. */
const TOO_LARGE_CLASS = "text-body text-secondary select-text break-words";
const FILE_CHANGE_TOO_LARGE =
	"Preview unavailable — this change is too large to show here (over 200,000 characters). The full change appears in the conversation after it runs.";
const DETAIL_NOTE_CLASS = "text-footnote text-muted-as-secondary select-text break-words [unicode-bidi:plaintext]";
const DESCRIPTION_CLASS =
	"text-body text-secondary select-text break-words max-h-[calc(3*var(--text-body--line-height))] overflow-y-auto scroll-fade-size-[calc(1*var(--text-body--line-height))] [unicode-bidi:plaintext]";
/** Upstream's `vC`: beside an in-flow card's read-gated detail, the description drops the three-line clamp for 12 lines. */
const DESCRIPTION_READ_GATED_CLASS =
	"text-body text-secondary select-text break-words [unicode-bidi:plaintext] max-h-[12lh] overflow-y-auto";

/** Upstream's title gate hint (`1oftTg`). */
export const TITLE_READ_HINT = "Scroll the title to its end to allow this.";
/** Upstream's title gate hint once the title is scrolled above the card's view (`H9kdxn`). */
export const TITLE_UP_HINT = "Scroll up to see what you’re allowing.";
/** Upstream's read hint above the actions, centred in a stacked (≤420px) card. */
const READ_HINT_CLASS =
	"epitaxy-approval-read-hint text-footnote text-muted-as-secondary text-end text-balance @max-[420px]:text-center";

/** Upstream's `OC.standard`: a gated detail shows six lines before it scrolls. */
const DETAIL_READ_LINES = 6;
/** Upstream's gated detail box (`cx`), its focus ring drawn when the scroller inside has focus. */
const GATED_DETAIL_CLASS =
	"bg-alpha-1 rounded-lg py-md px-lg text-code text-secondary whitespace-pre-wrap break-words select-text [unicode-bidi:plaintext] has-[:focus-visible]:shadow-focus";
/** Upstream's slack: a line box may sit 2px outside the visible box and still count as seen. */
const SLACK = 2;

/**
 * Upstream's detail read gate (`VC`, was `Sx`): the detail capped to six lines, a focusable labelled scroller once it
 * overflows, and `read` reported only once its head and end lines, its note's first and last lines and every
 * read-line in the card have each been seen (through the two-frame latch).
 */
function CommandReadGate({
	label,
	note,
	read,
	warned = false,
	onReadState,
	children,
}: {
	label: string;
	note: string | null;
	read: boolean;
	/** Upstream's `detailWarning`: at least one read-line (the warning) must exist. */
	warned?: boolean;
	onReadState: (state: ReadGateState) => void;
	children: ReactNode;
})
{
	const detailRef = useRef<HTMLDivElement>(null);
	const noteRef = useRef<HTMLParagraphElement>(null);
	const [overflows, setOverflows] = useState(false);
	useEffect(() =>
	{
		const element = detailRef.current;
		const win = windowOf(element);
		if (element === null || win === null)
		{
			onReadState("read");
			return undefined;
		}
		let rerun: (() => void) | null = null;
		const latch = createReadLatch(element, win, () => rerun?.());
		const check = (report: (state: ReadGateState) => void) =>
		{
			rerun ??= () =>
			{
				check(report);
			};
			const lineHeight = Number.parseFloat(win.getComputedStyle(element).lineHeight);
			if (!Number.isFinite(lineHeight))
			{
				report(element.clientHeight === 0 ? "unlaid" : "unread");
				return;
			}
			const cap = lineHeight * DETAIL_READ_LINES;
			const laid = element.clientHeight !== 0;
			const shown = Math.min(element.clientHeight, cap);
			const overflow = element.scrollHeight - shown > SLACK;
			if (laid) latch.pass();
			const head = latch.seen(
				"head",
				() => laid && element.scrollTop <= SLACK && lineSeen(element, win, lineHeight, "first"),
				() => laid && lineSeen(element, win, lineHeight, "first"),
			);
			const end = latch.seen(
				"end",
				() =>
					laid &&
					element.scrollTop + shown >= element.scrollHeight - SLACK &&
					lineSeen(element, win, lineHeight, "last"),
				() => laid && lineSeen(element, win, lineHeight, "last"),
			);
			const noteLine = noteRef.current;
			const noteSeen = (edge: "first" | "last") =>
				noteLine === null ||
				latch.seen(
					`note${edge}`,
					() =>
						laid &&
						lineSeen(
							noteLine,
							win,
							Number.parseFloat(win.getComputedStyle(noteLine).lineHeight) || 0,
							edge,
						),
				);
			const lines = cardReadLines(element);
			const rest = [
				noteSeen("first"),
				noteSeen("last"),
				readLinesSeen(lines, win, latch.seen, laid),
				!warned || lines.length > 0,
			];
			element.style.maxHeight = `${cap}px`;
			if (!laid)
			{
				report("unlaid");
				return;
			}
			setOverflows(overflow);
			report(head && end && rest.every(Boolean) ? (latch.waiting() ? "waiting" : "read") : "unread");
		};
		const watch = watchReadGate(element, win, [noteRef.current], check, onReadState);
		return () =>
		{
			rerun = null;
			latch.forget();
			watch.stop();
		};
	}, [onReadState, warned]);
	const gate = (
		<div data-approval-value className={GATED_DETAIL_CLASS}>
			<div
				ref={detailRef}
				data-testid="approval-read-detail"
				{...(overflows
					?
						{
							tabIndex: 0,
							role: "group",
							"aria-label": label,
							className: `overflow-y-auto scroll-fade-y scroll-fade-size-[8px] focus-visible:outline-hidden${read ? " overscroll-contain" : ""}`,
						}
					: {})}
			>
				{children}
			</div>
		</div>
	);
	return note === null ? (
		gate
	) : (
		<div className="flex flex-col gap-[12px]">
			{gate}
			<p ref={noteRef} data-testid="approval-detail-note" className={DETAIL_NOTE_CLASS}>
				{note}
			</p>
		</div>
	);
}

/** Upstream's trail rows panel: the tinted "What Claude sent" block closing the card body. */
function RowsPanel({rows, foldable, clamp}: {rows: readonly PermissionRow[]; foldable: boolean; clamp: boolean})
{
	return (
		<div data-permission-rows-panel className="flex flex-col gap-1 rounded-lg bg-alpha-1 px-3 py-2">
			<span aria-hidden className="text-footnote text-muted-as-secondary">
				{PERMISSION_ROWS_LABEL}
			</span>
			<PermissionRowsList rows={rows} foldable={foldable} clamp={clamp} />
		</div>
	);
}

/** Upstream's saves lead (`XcdDjt`): the same copy whatever the rules' destination. */
const SAVES_LEAD = "\u201CAlways allow\u201D lasts for this session and covers:";
const ACCEPT_EDITS_MODE_SAVE =
	"Accept edits mode (file edits, and file commands such as rm and mv, in this session\u2019s folders)";

/** Upstream's rule code (`Xb`, now `Cx`): one line, its hidden characters shown. */
function SaveCode({text}: {text: string})
{
	return <code className="text-code-medium break-all [unicode-bidi:plaintext]">{visibleSingleLine(text)}</code>;
}

function saveItem(save: PersistentAllowSave): ReactNode
{
	switch (save.kind)
	{
		case "rule":
			return save.ruleContent === undefined ? (
				<>
					every use of <SaveCode text={save.toolName} />
				</>
			) : (
				<SaveCode text={`${save.toolName}(${save.ruleContent})`} />
			);
		case "acceptEditsMode":
			return ACCEPT_EDITS_MODE_SAVE;
		default:
			return assertNever(save);
	}
}

/**
 * Upstream's web saves block (cc32965c2 `Zb`, now `wx`): what "Always allow" adds, after the lead. One item
 * shares the lead's paragraph; otherwise the items are a list labelled by the lead, empty when nothing listable
 * is saved. `gap-xs` is 6px at the default density the local app copies.
 */
function AlwaysAllowSaves({saves}: {saves: readonly PersistentAllowSave[]})
{
	const leadId = useId();
	const items = saves.map(saveItem);
	if (items.length === 1)
	{
		return (
			<p data-testid="approval-always-allow-saves" className="text-body text-secondary select-text">
				{SAVES_LEAD} {items[0]}
			</p>
		);
	}
	return (
		<div
			data-testid="approval-always-allow-saves"
			className="flex flex-col gap-[6px] text-body text-secondary select-text"
		>
			<span id={leadId}>{SAVES_LEAD}</span>
			<ul role="list" aria-labelledby={leadId} className="flex flex-col gap-[6px]">
				{items.map((item, index) => (
					// oxlint-disable-next-line react/no-array-index-key -- the saves are fixed for the card's life
					<li key={index}>{item}</li>
				))}
			</ul>
		</div>
	);
}

/** Upstream's fold label (`Ox` trigger child). */
const FOLD_LABEL_CLASS = "text-footnote text-muted-control";
/** Upstream's unlined fold text (`Ox`). */
const FOLD_TEXT_CLASS =
	"mt-1 bg-alpha-1 rounded-lg py-md px-lg text-code text-secondary whitespace-pre-wrap break-all select-text [unicode-bidi:bidi-override]";

/** Upstream's fold renderer (cc32965c2 `Ox`, was `Zb`): a cds Collapsible holding lined or plain text. */
function PermissionFoldView({fold}: {fold: PermissionFold})
{
	return (
		<Collapsible.Root defaultOpen={fold.open === true}>
			<Collapsible.Trigger>
				<span className={FOLD_LABEL_CLASS}>{fold.label}</span>
			</Collapsible.Trigger>
			<Collapsible.Panel>
				{fold.lined === true ? (
					<div className="mt-1 overflow-hidden rounded-lg bg-alpha-1">
						<LinedScript script={fold.text} />
					</div>
				) : (
					<pre dir="ltr" className={FOLD_TEXT_CLASS}>
						{fold.text}
					</pre>
				)}
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

/** Upstream's Workflow callout (`PPAbdB`); "background tasks pane" opens the Background tasks pane where one can host it. */
function TokenWarning()
{
	const backgroundTasks = useBackgroundTasksOpener();
	return (
		<div className="rounded-lg bg-alpha-1 px-lg py-2.5 text-body text-secondary select-text break-words">
			Dynamic workflows run many subagents in parallel and can use a lot of your usage limit. Stop them any time
			from the{" "}
			{backgroundTasks === null ? (
				"background tasks pane"
			) : (
				<button
					type="button"
					data-cds="TextLink"
					className="cds-reset text-link inline cursor-pointer"
					onClick={() =>
					{
						backgroundTasks.open();
					}}
				>
					background tasks pane
				</button>
			)}
			.
		</div>
	);
}

const TITLE_PART = "text-primary [unicode-bidi:plaintext]";

/**
 * Upstream's title: the action and meta are their own bidi-isolated spans inside the approval value,
 * which a clamped title (`clampTitle`) draws as a two-line `line-clamp-2` span instead.
 */
function PermissionTitleText({title, clamp}: {title: PermissionTitle; clamp: boolean})
{
	if (!("action" in title)) return <span className={TITLE_PART}>{title.heading}</span>;
	return (
		<span
			data-permission-title-value
			{...(clamp
				?
					{
						className: "line-clamp-2",
					}
				:
					{
						"data-approval-value": "",
					})}
		>
			Allow Claude to <span className={TITLE_PART}>{title.action}</span>
			{title.meta !== null && (
				<>
					{" "}
					<span className={TITLE_PART}>{title.meta}</span>
				</>
			)}
			?
		</span>
	);
}
