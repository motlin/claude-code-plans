import {useQueryClient} from "@tanstack/react-query";
import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {
	type PermissionModeConsent,
	permissionModeConsentQueryOptions,
	postPermissionModeConsent,
} from "../lib/api/permission-mode-consent";
import {
	type ConsentMode,
	consentCopy,
	isAcked,
	needsConsent,
	PERMISSION_SECURITY_GUIDE_URL,
	recordAck,
} from "../lib/permission-mode-consent";
import {bidiIsolatedText, bidiRuns, visibleSingleLine} from "../lib/visible-text";
import {ConfirmDialog} from "./confirm-dialog";
import {ExternalTextLink} from "./external-text-link";

/** Upstream c2d1aeb56's scroll region class after tailwind-merge (verified live 2026-11-05). */
const PATH_CLASS =
	"scroll-fade-y focus-visible:outline-hidden mt-3 max-h-24 overflow-y-auto font-mono-ui text-code text-primary break-all focus-visible:shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fill-accent focus-visible:-outline-offset-2 focus-visible:scroll-fade-hide-top focus-visible:scroll-fade-hide-bottom";

export interface PendingConsent {
	mode: ConsentMode;
	asksEveryTime: boolean;
}

/**
 * Upstream's workspace folder block: the path on one visible line, RTL runs isolated, and a focusable "Workspace
 * folder" group only while it overflows its four lines.
 */
function WorkspacePath({workspace}: {workspace: string}) {
	const ref = useRef<HTMLDivElement>(null);
	const [overflows, setOverflows] = useState(false);
	const runs = bidiRuns(visibleSingleLine(workspace));
	useLayoutEffect(() => {
		const element = ref.current;
		if (element === null) return undefined;
		const measure = () => {
			setOverflows(element.scrollHeight > element.clientHeight);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, [workspace]);
	return (
		<div
			ref={ref}
			data-fixed-code-size=""
			dir="ltr"
			title={bidiIsolatedText(runs)}
			className={PATH_CLASS}
			{...(overflows
				? {
						tabIndex: 0,
						role: "group",
						"aria-label": "Workspace folder",
						onFocus: (event: React.FocusEvent<HTMLDivElement>) => {
							if (event.currentTarget.matches(":focus-visible")) {
								event.currentTarget.scrollIntoView({block: "nearest"});
							}
						},
					}
				: {})}
		>
			{runs.map((run, index) =>
				run.rtl ? (
					// eslint-disable-next-line react/no-array-index-key -- runs have no identity beyond their order
					<bdi key={index} dir="rtl">
						{run.text}
					</bdi>
				) : (
					run.text
				),
			)}
		</div>
	);
}

/**
 * Upstream's permission mode consent dialog (cbf7370a7): "Bypass all permissions?" or "Enable auto mode?", the
 * workspace folder, a footnote to the security guide, Cancel (initial focus) and a primary confirm.
 */
export function PermissionModeConsentDialog({
	pending,
	workspace,
	onConfirm,
	onCancel,
}: {
	pending: PendingConsent | null;
	workspace: string;
	onConfirm: () => void;
	/** Cancel, Escape or a backdrop click. */
	onCancel: () => void;
}) {
	// Keeps the copy while the dialog fades out.
	const [shown, setShown] = useState(pending);
	if (pending !== null && pending !== shown) setShown(pending);
	const confirmedRef = useRef(false);
	const current = pending ?? shown;
	if (current === null) return null;
	const copy = consentCopy({mode: current.mode, workspace, asksEveryTime: current.asksEveryTime});
	return (
		<ConfirmDialog
			open={pending !== null}
			onOpenChange={(open) => {
				if (open) return;
				if (confirmedRef.current) {
					confirmedRef.current = false;
					return;
				}
				onCancel();
			}}
			title={copy.title}
			body={copy.description}
			confirmLabel={copy.confirmLabel}
			variant="primary"
			onConfirm={() => {
				confirmedRef.current = true;
				onConfirm();
			}}
		>
			{workspace !== "" && <WorkspacePath workspace={workspace} />}
			<p className="mt-3 text-footnote text-muted-as-secondary">
				{copy.footnoteLead}
				<ExternalTextLink href={PERMISSION_SECURITY_GUIDE_URL} rel="noopener">
					security guide
				</ExternalTextLink>
				{" for details."}
			</p>
		</ConfirmDialog>
	);
}

export interface GuardRequest {
	mode: ConsentMode;
	proceed: () => void;
}

/** Until the store answers, nothing counts as consented: the dialog asks. */
const UNKNOWN: PermissionModeConsent = {autoModeIsDefault: false, autoConsented: false, acks: []};

/**
 * Reads the store fresh for each guarded pick, then proceeds at once when nothing is owed, or holds the pick behind
 * the consent dialog. Mounted only once a guarded pick happens, so a chin that never picks Auto or Bypass needs no
 * query client.
 */
export function PermissionModeConsentGate({
	request,
	workspace,
	onSettled,
}: {
	request: GuardRequest | null;
	workspace: string;
	onSettled: () => void;
}) {
	const queryClient = useQueryClient();
	const [asking, setAsking] = useState<GuardRequest | null>(null);
	useEffect(() => {
		if (request === null) return undefined;
		let cancelled = false;
		void queryClient
			.query({...permissionModeConsentQueryOptions, staleTime: 0})
			.catch(() => UNKNOWN)
			.then((state) => {
				if (cancelled) return;
				const owed =
					needsConsent(request.mode, {autoIsDefault: state.autoModeIsDefault}) &&
					!isAcked(request.mode, {...state, workspace});
				if (owed) {
					setAsking(request);
				} else {
					onSettled();
					request.proceed();
				}
			});
		return () => {
			cancelled = true;
		};
		// A new request object is a new pick; the workspace and callback are read at that pick.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [request]);

	const confirm = () => {
		if (asking === null) return;
		const key = permissionModeConsentQueryOptions.queryKey;
		const state = queryClient.getQueryData(key) ?? UNKNOWN;
		queryClient.setQueryData(key, {...state, ...recordAck({mode: asking.mode, workspace, ...state})});
		void postPermissionModeConsent({mode: asking.mode, workspace})
			.then((stored) => {
				queryClient.setQueryData(key, stored);
			})
			.catch(async () => queryClient.invalidateQueries({queryKey: key}));
		setAsking(null);
		onSettled();
		asking.proceed();
	};

	return (
		<PermissionModeConsentDialog
			pending={asking === null ? null : {mode: asking.mode, asksEveryTime: false}}
			workspace={workspace}
			onConfirm={confirm}
			onCancel={() => {
				setAsking(null);
				onSettled();
			}}
		/>
	);
}
