import {writeClipboardText} from "../../lib/clipboard";
import {useToast} from "../toast-context";

/** Upstream `we`: one success toast for every Copy row. The failure toast is a local extra. */
export function useCopyToClipboard(): (text: string) => void
{
	const toast = useToast();
	return (text) =>
	{
		void writeClipboardText(text).then((copied) =>
		{
			toast(
				copied
					?
						{
							kind: "success",
							message: "Copied to clipboard.",
						}
					:
						{
							kind: "error",
							message: "Couldn’t copy to clipboard.",
						},
			);
		});
	};
}
