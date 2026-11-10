import {type MouseEvent, type ReactNode, useEffect, useId, useState} from "react";

import {
	deceptiveHost,
	displayUrl,
	embeddedCredentialsHost,
	isNonWebLink,
	isTrustedDomainLink,
	opensWithoutConfirm,
	trustableDomain,
	trustDomain,
} from "../lib/external-nav";
import {ConfirmDialog} from "./confirm-dialog";
import {ExternalLinkHint} from "./external-text-link";
import {Icon} from "./ui/icon";

/** Upstream `N1`: right-aligns ltr runs on an rtl page. */
const RTL_TEXT_END = "[&:where(:root[dir=rtl]_*)]:text-right";

/** Upstream `CL`'s default `activationDelayMs`: the confirm button arms after the dialog has shown this long. */
const ACTIVATION_DELAY_MS = 400;

/** Upstream `kv`: open the link in a new window without handing it this page. */
function openExternally(url: string): void {
	window.open(url, "_blank", "noopener,noreferrer");
}

/** Upstream `Ja`: a red warning box with the real destination. */
function DeceptionWarning({message, detail, testId}: {message: string; detail: string; testId?: string}) {
	return (
		<div data-testid={testId} className="mt-3 rounded-lg border border-danger bg-danger p-3">
			<div className="flex items-start gap-2">
				<Icon name="Warning" size="md" className="text-danger" />
				<div className="text-body text-danger">
					<p className="font-medium">{message}</p>
					<p dir="ltr" className={`mt-1 font-mono break-all ${RTL_TEXT_END}`}>
						{detail}
					</p>
				</div>
			</div>
		</div>
	);
}

/** Upstream `CL`, simplified to a timer from when the dialog opens (upstream counts only visible, focused time). */
function useArmed(open: boolean): boolean {
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		if (!open) {
			setArmed(false);
			return undefined;
		}
		const timer = setTimeout(() => {
			setArmed(true);
		}, ACTIVATION_DELAY_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [open]);
	return armed;
}

/**
 * Upstream `Ec` (via `hz`) for a web link: "Open external link", the URL, an optional "Don't ask again" for
 * the link's domain, and warnings for a punycode host or embedded credentials.
 */
function ExternalLinkDialog({
	open,
	url,
	onClose,
	onConfirm,
}: {
	open: boolean;
	url: string;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const armed = useArmed(open);
	const [dontAskAgain, setDontAskAgain] = useState(false);
	const checkboxId = useId();
	const {punycode} = deceptiveHost(url);
	const credentialsHost = embeddedCredentialsHost(url);
	const domain = punycode === null && credentialsHost === null ? trustableDomain(url) : null;
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					setDontAskAgain(false);
					onClose();
				}
			}}
			title="Open external link"
			body="You’re leaving Claude to visit an external link:"
			size="md"
			confirmLabel="Open link"
			confirmDisabled={!armed}
			onConfirm={() => {
				if (dontAskAgain) trustDomain(url);
				setDontAskAgain(false);
				onConfirm();
			}}
		>
			<div className="mt-3 max-h-40 overflow-y-scroll break-all rounded-lg border bg-surface-1 px-4 py-3 text-primary">
				<span dir="ltr" className={`block ${RTL_TEXT_END}`}>
					{displayUrl(url)}
				</span>
			</div>
			{domain !== null && (
				<div className="mt-3">
					<label htmlFor={checkboxId} className="flex items-center gap-2 text-body text-primary">
						<input
							id={checkboxId}
							type="checkbox"
							disabled={!armed}
							checked={dontAskAgain}
							onChange={(event) => {
								if (armed) setDontAskAgain(event.currentTarget.checked);
							}}
						/>
						<span>
							Don’t ask again for links to{" "}
							<code dir="ltr" className="font-mono">
								{domain}
							</code>
						</span>
					</label>
				</div>
			)}
			{credentialsHost !== null && (
				<DeceptionWarning
					testId="userinfo-warning"
					message="This link contains embedded credentials, which may be an attempt to disguise its destination. You will actually be sent to:"
					detail={credentialsHost}
				/>
			)}
			{punycode !== null && (
				<DeceptionWarning
					message="This link contains an internationalized domain name that may be deceptive. The domain appears as:"
					detail={punycode}
				/>
			)}
		</ConfirmDialog>
	);
}

/**
 * Upstream `jq` under the tool body's "confirm" link policy, inside an external cds TextLink: a trusted or
 * same-origin link navigates itself; a link to a domain the viewer stopped being asked about opens at once, as
 * does a modifier-clicked plain web link; anything else asks first. A middle click asks too.
 */
export function ConfirmExternalLink({
	href,
	children,
	className = "text-link inline cursor-pointer",
}: {
	href: string;
	children: ReactNode;
	className?: string;
}) {
	const [asking, setAsking] = useState(false);
	// Upstream `hz` mounts the dialog only once it is wanted (and keeps it through its exit).
	const [dialogMounted, setDialogMounted] = useState(false);
	const hintId = useId();
	const ask = () => {
		setDialogMounted(true);
		setAsking(true);
	};
	const direct = opensWithoutConfirm(href);
	/** Upstream `D`: whether this click may open without the dialog. */
	const skipsDialog = (modifier: boolean) =>
		isTrustedDomainLink(href) ||
		(modifier &&
			!isNonWebLink(href) &&
			deceptiveHost(href).punycode === null &&
			embeddedCredentialsHost(href) === null);
	const onClick = (event: MouseEvent) => {
		if (direct) return;
		event.preventDefault();
		if (skipsDialog(event.shiftKey || event.ctrlKey || event.metaKey)) {
			openExternally(href);
			return;
		}
		ask();
	};
	const onAuxClick = (event: MouseEvent) => {
		if (event.button !== 1 || direct) return;
		event.preventDefault();
		if (skipsDialog(false)) {
			openExternally(href);
			return;
		}
		ask();
	};
	return (
		<>
			<a
				data-cds="TextLink"
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				dir="ltr"
				className={className}
				aria-describedby={hintId}
				onClick={onClick}
				onAuxClick={onAuxClick}
			>
				{children}
				<ExternalLinkHint id={hintId} />
			</a>
			{dialogMounted && (
				<ExternalLinkDialog
					open={asking}
					url={href}
					onClose={() => {
						setAsking(false);
					}}
					onConfirm={() => {
						setAsking(false);
						openExternally(href);
					}}
				/>
			)}
		</>
	);
}
