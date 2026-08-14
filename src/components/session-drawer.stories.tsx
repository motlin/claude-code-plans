import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SessionDrawer } from "./session-drawer";

const meta = {
  title: "Session Detail/SessionDrawer",
  component: SessionDrawer,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SessionDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

function ResizableNonModalExample(arguments_: Story["args"]) {
  const [backgroundClicks, setBackgroundClicks] = useState(0);
  const [isOpen, setIsOpen] = useState(true);

  return (
    <main className="min-h-screen bg-surface-2 p-8 text-primary">
      <div className="max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Transcript behind the drawer</h1>
        <p className="text-sm text-t6">
          This content remains clickable and scrollable while the drawer is open.
        </p>
        <button
          type="button"
          onClick={() => setBackgroundClicks((clicks) => clicks + 1)}
          className="rounded-md border border-border bg-surface-0 px-3 py-2 text-sm"
        >
          Background clicks: {backgroundClicks}
        </button>
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="ml-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            Reopen drawer
          </button>
        )}
      </div>

      {isOpen && (
        <SessionDrawer {...arguments_} onClose={() => setIsOpen(false)}>
          <ol className="divide-y divide-border">
            {Array.from({ length: 24 }, (_, index) => (
              <li key={index} className="px-4 py-3 text-sm">
                Session resource {index + 1}
              </li>
            ))}
          </ol>
        </SessionDrawer>
      )}
    </main>
  );
}

export const ResizableNonModal: Story = {
  args: {
    title: "Session files",
    count: 24,
    onClose: () => undefined,
    children: null,
  },
  render: (arguments_) => <ResizableNonModalExample {...arguments_} />,
};
