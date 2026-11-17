import {FileColumnPositionSchema, useSettings} from "../settings-context";
import {MenuRadioGroup, MenuRadioItem, MenuSub, MenuSubContent, MenuSubTrigger} from "../ui/menu";
import {FILE_COLUMN_POSITION_LABELS} from "./file-column-side";

/**
 * Upstream c9bd7af9c `HT(kind)`: the Files ⋯ "File tree position" and Changes ⋯ "File list position"
 * submenu, both over the one shared setting. The trigger hints the current value; a pick closes the menu.
 */
export function FileColumnPositionSubmenu({label}: {label: "File tree position" | "File list position"})
{
	const {settings, setSetting} = useSettings();
	const position = settings.fileColumnPosition;
	return (
		<MenuSub>
			<MenuSubTrigger value={FILE_COLUMN_POSITION_LABELS[position]}>{label}</MenuSubTrigger>
			<MenuSubContent>
				<MenuRadioGroup
					value={position}
					onValueChange={(value: unknown) =>
					{
						const parsed = FileColumnPositionSchema.safeParse(value);
						if (parsed.success) setSetting("fileColumnPosition", parsed.data);
					}}
				>
					{FileColumnPositionSchema.options.map((option) => (
						<MenuRadioItem key={option} value={option} closeOnClick>
							{FILE_COLUMN_POSITION_LABELS[option]}
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			</MenuSubContent>
		</MenuSub>
	);
}
