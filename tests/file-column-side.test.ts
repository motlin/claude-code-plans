import {type FileColumnSideInput, resolveFileColumnOnRight} from "../src/components/files/file-column-side";

describe("resolveFileColumnOnRight", () =>
{
	it("follows the row-end tile when Automatic, and the physical side otherwise, like upstream cf3dc7910 `ce`", () =>
	{
		const inputs: FileColumnSideInput[] = [
			{
				position: "auto",
				rowEnd: true,
				rtl: false,
			},
			{
				position: "auto",
				rowEnd: false,
				rtl: false,
			},
			{
				position: "left",
				rowEnd: true,
				rtl: false,
			},
			{
				position: "right",
				rowEnd: false,
				rtl: false,
			},
			{
				position: "right",
				rowEnd: false,
				rtl: true,
			},
			{
				position: "left",
				rowEnd: false,
				rtl: true,
			},
		];
		expect(inputs.map(resolveFileColumnOnRight)).toStrictEqual([true, false, false, true, false, true]);
	});
});
