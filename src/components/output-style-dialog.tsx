import {useState} from "react";

import type {OutputStyleItem} from "../lib/output-style-options";
import {ConfirmDialog} from "./confirm-dialog";
import {Select} from "./ui/select";

/**
 * Upstream's `/output-style` host dialog (`Swe`): a style Select with no visible label inside a small confirm,
 * starting on the session's style (else the first). Apply on an unchanged style only closes.
 *
 * Upstream applies the pick as a session-only flag setting, hence "Applies to this session only."; locally Apply
 * sends `/output-style <name>` to the CLI, which also saves it to the project's `.claude/settings.local.json`.
 * The copy stays upstream's for parity.
 */
export function OutputStyleDialog({
	items,
	onApply,
	onClose,
}: {
	items: readonly OutputStyleItem[];
	onApply: (name: string) => void;
	onClose: () => void;
})
{
	const [value, setValue] = useState(() => (items.find((item) => item.checked) ?? items[0])?.name);
	return (
		<ConfirmDialog
			open
			onOpenChange={(open) =>
			{
				if (!open) onClose();
			}}
			title="Output style"
			body="Applies to this session only."
			confirmLabel="Apply"
			confirmDisabled={value === undefined}
			onConfirm={() =>
			{
				const item = items.find((candidate) => candidate.name === value);
				if (item !== undefined && !item.checked) onApply(item.name);
			}}
		>
			{/* Upstream's `pt-md`: 8px under the dialog's comfortable density. */}
			<div className="pt-2">
				<Select
					ariaLabel="Output style"
					placeholder="Choose a style"
					items={items.map((item) => (
					{
						value: item.name,
						label: item.label,
					}))}
					value={value ?? null}
					onChange={setValue}
				/>
			</div>
		</ConfirmDialog>
	);
}
