import {
	BookOpen,
	Bookmark,
	Briefcase,
	Bug,
	Code,
	Flag,
	Folder,
	Heart,
	House,
	Rocket,
	Star,
	Zap,
	type LucideIcon,
} from "lucide-react";

import {
	GroupColorSchema,
	GroupIconSchema,
	type GroupAppearance,
	type GroupAppearancePatch,
	type GroupColor,
	type GroupIcon,
} from "../../lib/group-appearance";
import {groupColorLabels, groupIconLabels} from "../../lib/schema-choices";
import {
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
} from "../ui/menu";

const ICONS = {
	folder: Folder,
	star: Star,
	heart: Heart,
	flag: Flag,
	bookmark: Bookmark,
	zap: Zap,
	code: Code,
	bug: Bug,
	rocket: Rocket,
	book: BookOpen,
	briefcase: Briefcase,
	home: House,
} as const satisfies Record<GroupIcon, LucideIcon>;

const TEXT_COLORS = {
	gray: "text-gray-500 dark:text-gray-400",
	red: "text-red-600 dark:text-red-400",
	orange: "text-orange-600 dark:text-orange-400",
	yellow: "text-yellow-600 dark:text-yellow-400",
	green: "text-green-600 dark:text-green-400",
	teal: "text-teal-600 dark:text-teal-400",
	blue: "text-blue-600 dark:text-blue-400",
	purple: "text-purple-600 dark:text-purple-400",
	pink: "text-pink-600 dark:text-pink-400",
} as const satisfies Record<GroupColor, string>;

const DOT_COLORS = {
	gray: "bg-gray-500 dark:bg-gray-400",
	red: "bg-red-600 dark:bg-red-400",
	orange: "bg-orange-600 dark:bg-orange-400",
	yellow: "bg-yellow-600 dark:bg-yellow-400",
	green: "bg-green-600 dark:bg-green-400",
	teal: "bg-teal-600 dark:bg-teal-400",
	blue: "bg-blue-600 dark:bg-blue-400",
	purple: "bg-purple-600 dark:bg-purple-400",
	pink: "bg-pink-600 dark:bg-pink-400",
} as const satisfies Record<GroupColor, string>;

const NONE = "none";

/** A section header's icon (tinted by its color), a color dot alone, or nothing. */
export function GroupAppearanceMark({appearance}: {appearance: GroupAppearance | undefined}) {
	const icon = appearance?.icon;
	const color = appearance?.color;
	if (icon === undefined && color === undefined) return null;
	const markProps = {
		"data-group-appearance": "",
		"data-group-icon": icon,
		"data-group-color": color,
		"aria-hidden": true,
	} as const;
	if (icon === undefined) {
		return (
			<span className="flex size-3.5 shrink-0 items-center justify-center" {...markProps}>
				<span className={`size-2 rounded-full ${color === undefined ? "" : DOT_COLORS[color]}`} />
			</span>
		);
	}
	const Icon = ICONS[icon];
	return (
		<span className="flex shrink-0" {...markProps}>
			<Icon className={`size-3.5 ${color === undefined ? "" : TEXT_COLORS[color]}`} />
		</span>
	);
}

/** "Icon and color ▸" for a section header menu: icon radios, then color radios. */
export function GroupAppearanceSubmenu({
	appearance,
	onChange,
}: {
	appearance: GroupAppearance | undefined;
	onChange: (patch: GroupAppearancePatch) => void;
}) {
	return (
		<MenuSub>
			<MenuSubTrigger>Icon and color</MenuSubTrigger>
			<MenuSubContent>
				<MenuLabel>Icon</MenuLabel>
				<MenuRadioGroup
					value={appearance?.icon ?? NONE}
					onValueChange={(value: unknown) => {
						const parsed = GroupIconSchema.safeParse(value);
						onChange({icon: parsed.success ? parsed.data : null});
					}}
				>
					<MenuRadioItem value={NONE}>None</MenuRadioItem>
					{GroupIconSchema.options.map((icon) => {
						const Icon = ICONS[icon];
						return (
							<MenuRadioItem key={icon} value={icon}>
								<span className="flex items-center gap-2">
									<Icon aria-hidden="true" className="size-4 shrink-0" />
									{groupIconLabels[icon]}
								</span>
							</MenuRadioItem>
						);
					})}
				</MenuRadioGroup>
				<MenuSeparator />
				<MenuLabel>Color</MenuLabel>
				<MenuRadioGroup
					value={appearance?.color ?? NONE}
					onValueChange={(value: unknown) => {
						const parsed = GroupColorSchema.safeParse(value);
						onChange({color: parsed.success ? parsed.data : null});
					}}
				>
					<MenuRadioItem value={NONE}>Default</MenuRadioItem>
					{GroupColorSchema.options.map((color) => (
						<MenuRadioItem key={color} value={color}>
							<span className="flex items-center gap-2">
								<span
									aria-hidden="true"
									className={`size-2.5 shrink-0 rounded-full ${DOT_COLORS[color]}`}
								/>
								{groupColorLabels[color]}
							</span>
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			</MenuSubContent>
		</MenuSub>
	);
}
