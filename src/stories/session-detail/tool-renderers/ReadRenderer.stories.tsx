import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadRenderer } from "../../../components/tool-renderers/read-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-read-1",
    name: "Read",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/ReadRenderer",
  component: ReadRenderer,
} satisfies Meta<typeof ReadRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithLineNumbers: Story = {
  args: {
    toolCall: makeToolCall({
      input: { file_path: "/Users/craig/projects/app/src/index.ts" },
      param: "/Users/craig/projects/app/src/index.ts",
      result:
        '1\timport express from "express";\n2\t\n3\tconst app = express();\n4\tapp.listen(3000);',
    }),
  },
};

export const PythonFile: Story = {
  args: {
    toolCall: makeToolCall({
      input: { file_path: "/Users/craig/projects/app/src/main.py" },
      param: "/Users/craig/projects/app/src/main.py",
      result:
        '1\timport os\n2\tfrom pathlib import Path\n3\t\n4\tdef main():\n5\t    root = Path(os.getcwd())\n6\t    for item in root.iterdir():\n7\t        if item.is_file():\n8\t            print(f"Found: {item.name}")\n9\t\n10\tif __name__ == "__main__":\n11\t    main()',
    }),
  },
};

export const JsonFile: Story = {
  args: {
    toolCall: makeToolCall({
      input: { file_path: "/Users/craig/projects/app/package.json" },
      param: "/Users/craig/projects/app/package.json",
      result:
        '1\t{\n2\t  "name": "my-app",\n3\t  "version": "1.0.0",\n4\t  "dependencies": {\n5\t    "express": "^4.18.0",\n6\t    "typescript": "^5.0.0"\n7\t  },\n8\t  "scripts": {\n9\t    "start": "node dist/index.js",\n10\t    "build": "tsc"\n11\t  }\n12\t}',
    }),
  },
};

export const FileNotFound: Story = {
  args: {
    toolCall: makeToolCall({
      input: { file_path: "/missing/file.ts" },
      param: "/missing/file.ts",
      result:
        "File does not exist. Note: your current working directory is /Users/craig/projects/app.",
      isError: true,
    }),
  },
};
