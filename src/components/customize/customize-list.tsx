import type {LucideIcon} from "lucide-react";
import type {ReactNode} from "react";
import {NoSearchMatches} from "./customize-empty";
import {ListRow} from "./list-row";
import {SectionHeader} from "./section-header";

interface CustomizeListItem {
	key: string;
	title: string;
	source: string;
	subtitle: string;
	meta?: ReactNode;
	actions?: ReactNode;
	onView?: () => void;
}

interface CustomizeListGroup {
	key: string;
	title: string;
	items: readonly CustomizeListItem[];
}

interface CustomizeListProps {
	groups: readonly CustomizeListGroup[];
	icon: LucideIcon;
	noun: string;
	searching: boolean;
	empty: ReactNode;
}

/** One `<section>` per group, each a SectionHeader + Counter over its ListRows. */
export function CustomizeList({groups, icon, noun, searching, empty}: CustomizeListProps) {
	const visible = groups.filter((group) => group.items.length > 0);
	if (visible.length === 0) return searching ? <NoSearchMatches noun={noun} /> : empty;

	return (
		<div className="flex flex-col gap-6">
			{visible.map((group, index) => (
				<section key={group.key} aria-labelledby={`customize-group-${index}`} className="flex flex-col">
					<SectionHeader id={`customize-group-${index}`} title={group.title} count={group.items.length} />
					{group.items.map((item) => (
						<ListRow
							key={item.key}
							icon={icon}
							title={item.title}
							source={item.source}
							subtitle={item.subtitle}
							{...(item.meta === undefined ? {} : {meta: item.meta})}
							{...(item.actions === undefined ? {} : {actions: item.actions})}
							{...(item.onView === undefined ? {} : {onView: item.onView})}
						/>
					))}
				</section>
			))}
		</div>
	);
}

export function ShortDate({ms}: {ms: number}) {
	const date = new Date(ms);
	return (
		<time dateTime={date.toISOString()}>{date.toLocaleDateString("en-US", {month: "short", day: "numeric"})}</time>
	);
}
