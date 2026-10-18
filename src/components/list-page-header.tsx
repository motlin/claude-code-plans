import type {ReactNode} from "react";
import {formatCount} from "../lib/pluralize";
import {CodePageHeader} from "./code-page-header";

interface ListPageHeaderProps {
	title: string;
	count: number;
	itemLabel: string;
	actions?: ReactNode;
}

/** Upstream's serif PageHeader with the list's item count as its caption and any actions on the toolbar row. */
export function ListPageHeader({title, count, itemLabel, actions}: ListPageHeaderProps) {
	return <CodePageHeader title={title} subtitle={formatCount(count, itemLabel)} toolbar={actions} />;
}
