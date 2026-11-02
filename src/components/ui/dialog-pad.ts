import {useFizzyLake} from "../../lib/fizzy-lake";

/*
 * Upstream shared-frame `js` (the styled cds Dialog.Popup): `h=MM("panels")&&!unstyled`, the popup gets
 * `_z="[--cds-pad-xl:var(--cds-pad-lg)]"` (16px comfortable) and `data-cds-fizzy`; panels off = `Xn`
 * `p-xl` (24 comfortable, 20 default, which the compact main column's epitaxy-root dialogs used).
 * Local has no --cds-pad-* variables, so each value is a literal class Tailwind can see.
 */
export interface DialogPad
{
	popup:
	{
		"data-cds": "Dialog";
		"data-cds-fizzy": "" | undefined;
	};
	p: string;
	mx: string;
	mb: string;
	mt: string;
	px: string;
	pb: string;
	scrollMb: string;
	maxHList: string;
}

type PadSet = Omit<DialogPad, "popup">;

const PAD_16: PadSet =
{
	p: "p-4",
	mx: "-mx-4",
	mb: "-mb-4",
	mt: "-mt-4",
	px: "px-4",
	pb: "pb-4",
	scrollMb: "last:scroll-mb-4",
	maxHList: "max-h-[calc(50vh+16px)]",
};

const PAD_20: PadSet =
{
	p: "p-5",
	mx: "-mx-5",
	mb: "-mb-5",
	mt: "-mt-5",
	px: "px-5",
	pb: "pb-5",
	scrollMb: "last:scroll-mb-5",
	maxHList: "max-h-[calc(50vh+20px)]",
};

const PAD_24: PadSet =
{
	p: "p-6",
	mx: "-mx-6",
	mb: "-mb-6",
	mt: "-mt-6",
	px: "px-6",
	pb: "pb-6",
	scrollMb: "last:scroll-mb-6",
	maxHList: "max-h-[calc(50vh+24px)]",
};

/** The popup markers and `--cds-pad-xl` classes of a styled dialog; `compactOrigin` is the pre-rollout 20px. */
export function useDialogPad({
	compactOrigin = false,
}:
{
	compactOrigin?: boolean;
} = {}): DialogPad
{
	const panels = useFizzyLake("panels");
	const set = panels ? PAD_16 : compactOrigin ? PAD_20 : PAD_24;
	return {
		popup:
		{
			"data-cds": "Dialog",
			"data-cds-fizzy": panels ? "" : undefined,
		},
		...set,
	};
}

/** Upstream `RQ` (Dialog.Footer): `mt-pad-lg` (16px comfortable), not gated on panels. */
export const DIALOG_FOOTER_CLASS = "mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end";
