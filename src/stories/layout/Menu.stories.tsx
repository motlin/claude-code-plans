import type {Meta, StoryObj} from "@storybook/react-vite";
import {useState} from "react";

import {
	ContextMenu,
	ContextMenuTrigger,
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../../components/ui/menu";
import {withDarkTheme, withTheme} from "./decorators";

function RowActions() {
	return (
		<>
			<MenuSub>
				<MenuSubTrigger>Open in</MenuSubTrigger>
				<MenuSubContent>
					<MenuItem accelerator="1">Terminal</MenuItem>
				</MenuSubContent>
			</MenuSub>
			<MenuSeparator />
			<MenuItem accelerator="p">Pin</MenuItem>
			<MenuItem accelerator="u">Mark as unread</MenuItem>
			<MenuItem accelerator="r">Rename</MenuItem>
			<MenuItem accelerator="c">Copy link</MenuItem>
			<MenuItem accelerator="f">Fork</MenuItem>
			<MenuSeparator />
			<MenuItem accelerator="a">Archive</MenuItem>
			<MenuItem accelerator="d" variant="danger">
				Delete
			</MenuItem>
		</>
	);
}

function FilterAndGroup() {
	const [status, setStatus] = useState("active");
	const [groupBy, setGroupBy] = useState("state");
	const [showPr, setShowPr] = useState(true);
	return (
		<Menu>
			<MenuTrigger className="rounded-r6 px-2 py-1 text-body text-primary">Filter</MenuTrigger>
			<MenuContent align="end" className="!min-w-[200px]">
				<MenuSub>
					<MenuSubTrigger value={status === "active" ? "Active" : "All"} valueAccent={status !== "active"}>
						Status
					</MenuSubTrigger>
					<MenuSubContent>
						<MenuRadioGroup value={status} onValueChange={setStatus}>
							<MenuRadioItem value="active">Active</MenuRadioItem>
							<MenuRadioItem value="all">All</MenuRadioItem>
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
				<MenuSeparator />
				<MenuSub>
					<MenuSubTrigger value={groupBy === "state" ? "State" : "Date"}>Group by</MenuSubTrigger>
					<MenuSubContent>
						<MenuRadioGroup value={groupBy} onValueChange={setGroupBy}>
							<MenuRadioItem value="date">Date</MenuRadioItem>
							<MenuRadioItem value="state">State</MenuRadioItem>
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
				<MenuSeparator />
				<MenuCheckboxItem checked={showPr} onCheckedChange={setShowPr}>
					Show PR status
				</MenuCheckboxItem>
				<MenuSeparator />
				<MenuItem>Clear filters</MenuItem>
			</MenuContent>
		</Menu>
	);
}

function Demo() {
	return (
		<div className="flex flex-col gap-6 p-6">
			<Menu>
				<MenuTrigger className="rounded-r6 px-2 py-1 text-body text-primary">More options</MenuTrigger>
				<MenuContent align="end">
					<RowActions />
				</MenuContent>
			</Menu>
			<FilterAndGroup />
			<ContextMenu>
				<ContextMenuTrigger className="rounded-r6 border border-dashed border-border p-4 text-body text-primary">
					Right-click this row
				</ContextMenuTrigger>
				<MenuContent>
					<RowActions />
				</MenuContent>
			</ContextMenu>
		</div>
	);
}

const meta = {
	title: "Layout/Menu",
	component: Demo,
	decorators: [withTheme],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LightMode: Story = {};

export const DarkMode: Story = {
	decorators: [withDarkTheme],
};
