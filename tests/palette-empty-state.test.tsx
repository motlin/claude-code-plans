import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vite-plus/test";
import {PaletteEmptyState} from "../src/components/palette-empty-state";

describe("PaletteEmptyState", () =>
{
	it("leaves out the Tab to compose hint without onCompose, as upstream's $r on a phone-latched open", () =>
	{
		const render = (onCompose?: () => void) =>
		{
			const html = renderToStaticMarkup(
				<PaletteEmptyState
					kind="nothing"
					message="No results for “zzqxvq”"
					onSearchAll={() =>
					{
					}}
					{...(onCompose === undefined
						? {}
						:
							{
								onCompose,
							})}
				/>,
			);
			return {
				text: html.replace(/<[^>]+>/gu, ""),
				kbd: html.includes("<kbd"),
			};
		};

		expect(
			{
				phone: render(),
				desktop: render(() => {}),
			},
		).toStrictEqual(
			{
				phone:
				{
					text: "No results for “zzqxvq”",
					kbd: false,
				},
				desktop:
				{
					text: "No results for “zzqxvq”Tab to compose",
					kbd: true,
				},
			},
		);
	});
});
