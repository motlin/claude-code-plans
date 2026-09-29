import { z } from "zod";

export const customizeSearchSchema = z.object({
  q: z.string().max(200).optional(),
  view: z.literal("discover").optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
});
export type CustomizeSearch = z.infer<typeof customizeSearchSchema>;

export type CustomizeSectionId = "skills" | "connectors" | "plugins";

export interface MenuOption {
  value: string;
  label: string;
}

export interface CustomizeSectionConfig {
  id: CustomizeSectionId;
  label: string;
  to: "/customize/skills" | "/customize/connectors" | "/customize/plugins";
  /** Plural noun for the no-match copy, "No <noun> match your search". */
  noun: string;
  searchPlaceholder: string;
  /** Connectors has no local Discover, so it hides the Yours | Discover control. */
  hasDiscover: boolean;
  filter: { label: string; options: readonly MenuOption[] };
  /** Connectors omits Sort upstream. */
  sort: readonly MenuOption[] | null;
  /** localStorage key that remembers the last Sort choice when `?sort=` is absent. */
  sortStorageKey?: string;
}

export const CUSTOMIZE_SECTIONS: readonly CustomizeSectionConfig[] = [
  {
    id: "skills",
    label: "Skills",
    to: "/customize/skills",
    noun: "skills",
    searchPlaceholder: "Search skills and plugins",
    hasDiscover: true,
    filter: {
      label: "Source",
      options: [
        { value: "all", label: "All" },
        { value: "personal", label: "Personal" },
        { value: "project", label: "Project" },
        { value: "plugin", label: "Plugins" },
        { value: "command", label: "Custom commands" },
      ],
    },
    sort: [
      { value: "edited", label: "Last edited" },
      { value: "name", label: "Name" },
    ],
    sortStorageKey: "ccb-customize-skills-sort",
  },
  {
    id: "connectors",
    label: "Connectors",
    to: "/customize/connectors",
    noun: "connectors",
    searchPlaceholder: "Search connectors",
    hasDiscover: false,
    filter: {
      label: "Show",
      options: [
        { value: "all", label: "All connectors" },
        { value: "enabled", label: "Enabled" },
        { value: "disabled", label: "Disabled" },
      ],
    },
    sort: null,
  },
  {
    id: "plugins",
    label: "Plugins",
    to: "/customize/plugins",
    noun: "plugins",
    searchPlaceholder: "Search skills and plugins",
    hasDiscover: true,
    filter: {
      label: "Show",
      options: [
        { value: "all", label: "All plugins" },
        { value: "official", label: "Official" },
        { value: "community", label: "Community" },
      ],
    },
    sort: [
      { value: "marketplace", label: "Marketplace" },
      { value: "name", label: "Name" },
    ],
  },
];

export function sectionForPathname(pathname: string): CustomizeSectionConfig {
  const segment = pathname.split("/")[2];
  return CUSTOMIZE_SECTIONS.find((section) => section.id === segment) ?? CUSTOMIZE_SECTIONS[0]!;
}

/** The chosen option, falling back to the first when the URL holds an unknown value. */
export function resolveOption(
  options: readonly MenuOption[],
  value: string | undefined,
): MenuOption {
  return options.find((option) => option.value === value) ?? options[0]!;
}

export function matchesQuery(q: string | undefined, ...fields: readonly string[]): boolean {
  const term = q?.trim().toLowerCase() ?? "";
  if (term === "") return true;
  return fields.some((field) => field.toLowerCase().includes(term));
}
