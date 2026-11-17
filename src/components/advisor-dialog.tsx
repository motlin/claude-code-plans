import {useState} from "react";

import {ADVISOR_OPTIONS, type AdvisorOption, advisorOptionFor, advisorOptionLabel} from "../lib/advisor";
import {ConfirmDialog} from "./confirm-dialog";
import {Select} from "./ui/select";

const ITEMS = ADVISOR_OPTIONS.map((value) => (
{
	value,
	label: advisorOptionLabel(value),
}));

/**
 * Upstream's `/advisor` host dialog (`Lwe`): a model Select with no visible label inside a small confirm.
 * `current` is the session's advisor model (undefined while unknown, null when off); a pick overrides it,
 * and Apply stays disabled until some option is known.
 */
export function AdvisorDialog({
	current,
	onApply,
	onClose,
}: {
	current: string | null | undefined;
	onApply: (option: AdvisorOption) => void;
	onClose: () => void;
})
{
	const [picked, setPicked] = useState<AdvisorOption | undefined>(undefined);
	const value = picked ?? advisorOptionFor(current);
	return (
		<ConfirmDialog
			open
			onOpenChange={(open) =>
			{
				if (!open) onClose();
			}}
			title="Advisor"
			body="Let Claude consult a stronger model at key moments."
			confirmLabel="Apply"
			confirmDisabled={value === undefined}
			onConfirm={() =>
			{
				if (value !== undefined) onApply(value);
			}}
		>
			{/* Upstream's `pt-md`: 8px under the dialog's comfortable density. */}
			<div className="pt-2">
				<Select
					ariaLabel="Advisor model"
					placeholder="Choose a model"
					items={ITEMS}
					value={value ?? null}
					onChange={setPicked}
				/>
			</div>
		</ConfirmDialog>
	);
}
