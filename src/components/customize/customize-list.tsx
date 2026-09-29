import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NoSearchMatches } from "./customize-empty";
import { ListRow } from "./list-row";
import { SectionHeader } from "./section-header";

export interface CustomizeListItem {
  key: string;
  title: string;
  source: string;
  subtitle: string;
  meta?: ReactNode;
}

export interface CustomizeListGroup {
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
export function CustomizeList({ groups, icon, noun, searching, empty }: CustomizeListProps) {
  const visible = groups.filter((group) => group.items.length > 0);
  if (visible.length === 0) return searching ? <NoSearchMatches noun={noun} /> : empty;

  return (
    <div className="flex flex-col gap-6">
      {visible.map((group, index) => (
        <section
          key={group.key}
          aria-labelledby={`customize-group-${index}`}
          className="flex flex-col"
        >
          <SectionHeader
            id={`customize-group-${index}`}
            title={group.title}
            count={group.items.length}
          />
          {group.items.map((item) => (
            <ListRow
              key={item.key}
              icon={icon}
              title={item.title}
              source={item.source}
              subtitle={item.subtitle}
              {...(item.meta === undefined ? {} : { meta: item.meta })}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

/** Group items by a key while keeping first-seen group order. */
export function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => { key: string; title: string },
  toItem: (item: T) => CustomizeListItem,
): CustomizeListGroup[] {
  const groups = new Map<string, { key: string; title: string; items: CustomizeListItem[] }>();
  for (const item of items) {
    const { key, title } = keyOf(item);
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, title, items: [] };
      groups.set(key, group);
    }
    group.items.push(toItem(item));
  }
  return [...groups.values()];
}

export function ShortDate({ ms }: { ms: number }) {
  const date = new Date(ms);
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
    </time>
  );
}
