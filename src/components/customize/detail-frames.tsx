import {useQuery} from "@tanstack/react-query";
import {SquareSlash} from "lucide-react";
import type {ReactElement, ReactNode} from "react";
import {
	customizeMcpServerDetailQueryOptions,
	customizePluginDetailQueryOptions,
	customizeSkillDetailQueryOptions,
	type PluginDetail,
	type SkillDetail,
} from "../../lib/api/customize";
import {ConnectorDetailHeader, ToolPermissions} from "./connector-detail";
import {CustomizeNotice} from "./customize-empty";
import {CustomizeBackLink} from "./customize-nav";
import {PluginDetailHeader} from "./plugin-detail";
import {SkillDetailHeader} from "./skill-detail";
import {IconTile} from "./icon-tile";
import {MarkdownView} from "../markdown-view";
import {userCommandFileQueryOptions} from "../../lib/api/plugins";

/** Where a detail renders: a /customize page, or the Settings dialog's fixed-header pane. */
export type DetailLayout = "page" | "dialog";

interface DetailShellProps {
	layout: DetailLayout;
	/** The back link, title row and tabs; null for the loading and not-found states. */
	header: ReactNode;
	/** The page column's classes; the dialog lays the body out itself. */
	pageClassName: string;
	children: ReactNode;
}

/**
 * On a page, the header over the body in one column. In the dialog, upstream's
 * detail frame: the header and tabs stay put (`shrink-0`) and only the body
 * scrolls, both in a `max-w-5xl` column inset by `px-xl` (comfortable 24px).
 */
function DetailShell({layout, header, pageClassName, children}: DetailShellProps): ReactElement {
	if (layout === "page") {
		return header === null ? (
			<>{children}</>
		) : (
			<div className={pageClassName}>
				{header}
				{children}
			</div>
		);
	}
	return (
		<div className="flex h-full min-h-0 flex-col">
			{header !== null && (
				<div className="shrink-0">
					<div className="mx-auto w-full max-w-5xl md:px-2 flex flex-col pt-3">
						<div className="px-6">{header}</div>
					</div>
				</div>
			)}
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-6 pb-6">
				<div className="mx-auto w-full max-w-5xl md:px-2 flex flex-1 flex-col">
					<div className="px-6 flex flex-1 flex-col">{children}</div>
				</div>
			</div>
		</div>
	);
}

interface FrameState {
	layout: DetailLayout;
	isPending: boolean;
	loading: string;
	notFound: ReactNode;
	/** The section's back link, shown above the not-found message like a real detail header's. */
	back: ReactNode;
}

/** The loading (while pending) or not-found body, in the layout's frame. */
function pendingOrMissing({layout, isPending, loading, notFound, back}: FrameState): ReactElement {
	if (isPending) {
		return (
			<DetailShell layout={layout} header={null} pageClassName="">
				<p className="text-body text-t6">{loading}</p>
			</DetailShell>
		);
	}
	return (
		<DetailShell
			layout={layout}
			header={<header className="flex flex-col gap-4">{back}</header>}
			pageClassName="flex flex-col gap-6"
		>
			{notFound}
		</DetailShell>
	);
}

/** Skill detail: loading and not-found states, else the header over `children(detail)`. */
export function SkillDetailFrame({
	skillId,
	layout = "page",
	children,
}: {
	skillId: string;
	layout?: DetailLayout;
	children: (detail: SkillDetail) => ReactNode;
}): ReactElement {
	const {data, isPending, isError} = useQuery(customizeSkillDetailQueryOptions(skillId));
	if (isPending || isError) {
		return pendingOrMissing({
			layout,
			isPending,
			loading: "Loading skill…",
			back: <CustomizeBackLink section="skills">Your skills</CustomizeBackLink>,
			notFound: (
				<CustomizeNotice
					title="Skill not found"
					body="It may have been removed or renamed since the list was loaded."
				/>
			),
		});
	}
	return (
		<DetailShell layout={layout} header={<SkillDetailHeader detail={data} />} pageClassName="flex flex-col gap-6">
			{children(data)}
		</DetailShell>
	);
}

/** Plugin detail: loading and not-found states, else the header over `children(detail)`. */
export function PluginDetailFrame({
	pluginId,
	layout = "page",
	children,
}: {
	pluginId: string;
	layout?: DetailLayout;
	children: (detail: PluginDetail) => ReactNode;
}): ReactElement {
	const {data, isPending, isError} = useQuery(customizePluginDetailQueryOptions(pluginId));
	if (isPending || isError) {
		return pendingOrMissing({
			layout,
			isPending,
			loading: "Loading plugin…",
			back: <CustomizeBackLink section="plugins">Plugins</CustomizeBackLink>,
			notFound: (
				<CustomizeNotice
					title="Plugin not found"
					body="It may have been uninstalled since the list was loaded."
				/>
			),
		});
	}
	return (
		<DetailShell layout={layout} header={<PluginDetailHeader detail={data} />} pageClassName="flex flex-col gap-6">
			{children(data)}
		</DetailShell>
	);
}

/** Connector detail for a `toConnectorSlug` id: header, copyable URL or command, and tool permissions. */
export function ConnectorDetailFrame({
	serverId,
	layout = "page",
}: {
	serverId: string;
	layout?: DetailLayout;
}): ReactElement {
	const query = customizeMcpServerDetailQueryOptions(serverId);
	const {data, isPending, isError} = useQuery(query);
	if (isPending || isError) {
		return pendingOrMissing({
			layout,
			isPending,
			loading: "Loading connector…",
			back: <CustomizeBackLink section="connectors">Your connectors</CustomizeBackLink>,
			notFound: (
				<CustomizeNotice
					title="Connector not found"
					body="It may have been removed or renamed since the list was loaded."
				/>
			),
		});
	}
	return (
		<DetailShell layout={layout} header={<ConnectorDetailHeader detail={data} />} pageClassName="flex flex-col">
			<ToolPermissions detail={data} detailQueryKey={query.queryKey} />
		</DetailShell>
	);
}

/** Custom command detail: back link and `/name` header over the command file's rendered markdown. */
export function CommandDetailFrame({
	source,
	filename,
	layout = "page",
}: {
	source: string;
	filename: string;
	layout?: DetailLayout;
}): ReactElement {
	const {data, isPending, isError} = useQuery(userCommandFileQueryOptions(source, filename));
	if (isPending || isError || data === null) {
		return pendingOrMissing({
			layout,
			isPending,
			loading: "Loading command…",
			back: <CustomizeBackLink section="skills">Your skills</CustomizeBackLink>,
			notFound: (
				<CustomizeNotice
					title="Command not found"
					body="It may have been removed or renamed since the list was loaded."
				/>
			),
		});
	}
	const header = (
		<header className="flex flex-col gap-4">
			<CustomizeBackLink section="skills">Your skills</CustomizeBackLink>
			<div className="flex min-w-0 items-start gap-4">
				<IconTile icon={SquareSlash} size="lg" />
				<div className="flex min-w-0 flex-col gap-0.5">
					<h2 className="m-0 min-w-0 truncate text-[15px]/[20px] font-[580] text-primary">
						/{filename.replace(/\.md$/, "")}
					</h2>
					<p className="m-0 break-words text-footnote text-muted-as-secondary">from {data.sourceName}</p>
				</div>
			</div>
		</header>
	);
	return (
		<DetailShell layout={layout} header={header} pageClassName="flex flex-col gap-6">
			<MarkdownView markdown={data.markdown} />
		</DetailShell>
	);
}
