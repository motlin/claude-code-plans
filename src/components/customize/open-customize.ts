import {useNavigate} from "@tanstack/react-router";
import {useCallback} from "react";
import {type CustomizeSection, customizeHash} from "../../lib/settings-hash";

/** Returns a function that opens a Customize section's Yours list in the Settings dialog over the current page. */
export function useOpenCustomize(): (section: CustomizeSection) => void
{
	const navigate = useNavigate();
	return useCallback(
		(section) =>
		{
			void navigate(
				{
					to: ".",
					search: true,
					params: true,
					hash: customizeHash(
						{
							section,
						},
					),
					resetScroll: false,
					hashScrollIntoView: false,
				},
			);
		},
		[navigate],
	);
}
