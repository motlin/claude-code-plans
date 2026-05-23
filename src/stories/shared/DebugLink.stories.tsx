import type { Meta, StoryObj } from "@storybook/react-vite";
import { DebugLink } from "../../components/debug-link";
import { SettingsProvider } from "../../components/settings-provider";

/**
 * DebugLink is hidden unless debug mode is enabled.
 * The decorator sets localStorage so SettingsProvider reads `showDebug: true`.
 *
 * Uses `render` instead of `args` because the component's discriminated union
 * props cannot be represented via Storybook's flattened args type.
 */
const meta = {
  title: "Shared/DebugLink",
  component: DebugLink,
  decorators: [
    (Story) => {
      localStorage.setItem("ccp-show-debug", "true");
      return (
        <SettingsProvider>
          <Story />
        </SettingsProvider>
      );
    },
  ],
} satisfies Meta;

export default meta;

// StoryObj<typeof meta> requires `args` due to the discriminated union props.
// Use a plain StoryObj since we use `render` instead of `args`.
type Story = StoryObj;

export const SessionLink: Story = {
  render: () => <DebugLink sessionId="abc123" uuid="deadbeef-1234-5678-9abc-def012345678" />,
};

export const MissingUuid: Story = {
  render: () => <DebugLink sessionId="abc123" uuid={undefined} />,
};
