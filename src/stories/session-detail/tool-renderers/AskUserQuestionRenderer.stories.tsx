import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Decorator } from "@storybook/react-vite";
import { AskUserQuestionRenderer } from "../../../components/tool-renderers/ask-user-question-renderer";
import { AskUserQuestionProvider } from "../../../components/ask-user-question-context";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

const withInactiveSession: Decorator = (Story) => (
  <AskUserQuestionProvider value={{ isSessionActive: false, submitAnswer: async () => {} }}>
    <Story />
  </AskUserQuestionProvider>
);

const withActiveSession: Decorator = (Story) => (
  <AskUserQuestionProvider value={{ isSessionActive: true, submitAnswer: async () => {} }}>
    <Story />
  </AskUserQuestionProvider>
);

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-auq-1",
    name: "AskUserQuestion",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/AskUserQuestionRenderer",
  component: AskUserQuestionRenderer,
  decorators: [withInactiveSession],
} satisfies Meta<typeof AskUserQuestionRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        question: "Which testing framework should we use?",
        options: [
          { label: "Vitest", description: "Fast Vite-native test runner" },
          { label: "Jest", description: "Widely adopted, large ecosystem" },
          { label: "Mocha", description: "Flexible and extensible" },
        ],
      },
    }),
  },
};

export const Answered: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        question: "Which testing framework should we use?",
        options: [
          { label: "Vitest", description: "Fast Vite-native test runner" },
          { label: "Jest", description: "Widely adopted, large ecosystem" },
          { label: "Mocha", description: "Flexible and extensible" },
        ],
      },
      result:
        'Your questions have been answered: "Which testing framework should we use?"="Vitest". You can now continue with these answers in mind.',
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: { question: "How should we proceed?" },
      result: "User declined to answer.",
      isError: true,
    }),
  },
};

export const ActiveSession: Story = {
  decorators: [withActiveSession],
  args: {
    toolCall: makeToolCall({
      input: {
        question: "Which testing framework should we use?",
        options: [
          { label: "Vitest", description: "Fast Vite-native test runner" },
          { label: "Jest", description: "Widely adopted, large ecosystem" },
          { label: "Mocha", description: "Flexible and extensible" },
        ],
      },
    }),
  },
};

export const AnsweredWithPreviewAnnotation: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        questions: [
          {
            question: "How should bash-mode commands render?",
            header: "Layout",
            options: [
              {
                label: "Combined bubble",
                description: "Stitch bash-input with stdout into one bubble",
              },
              {
                label: "Two separate bubbles",
                description: "Input and output as separate bubbles",
              },
              {
                label: "Input only",
                description: "Show only the command, hide output",
              },
            ],
          },
          {
            question: "How should stderr render?",
            header: "Stderr",
            options: [
              {
                label: "Red error styling",
                description: "Red-tinted block for stderr",
              },
              { label: "Same as stdout", description: "No special styling" },
            ],
          },
        ],
      },
      result:
        'Your questions have been answered: "How should bash-mode commands render?"="Combined bubble" selected preview:\n' +
        "$ git status\nOn branch main\nnothing to commit" +
        ', "How should stderr render?"="Red error styling".' +
        " You can now continue with these answers in mind.",
    }),
  },
};

export const AnsweredOther: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        question: "Which testing framework should we use?",
        options: [
          { label: "Vitest", description: "Fast Vite-native test runner" },
          { label: "Jest", description: "Widely adopted, large ecosystem" },
          { label: "Mocha", description: "Flexible and extensible" },
        ],
      },
      result:
        'Your questions have been answered: "Which testing framework should we use?"="bun:test". You can now continue with these answers in mind.',
    }),
  },
};

export const AnsweredLegacyEnvelope: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        question: "Which testing framework should we use?",
        options: [
          { label: "Vitest", description: "Fast Vite-native test runner" },
          { label: "Jest", description: "Widely adopted, large ecosystem" },
          { label: "Mocha", description: "Flexible and extensible" },
        ],
      },
      result:
        'User has answered your questions: "Which testing framework should we use?"="Vitest". You can now continue with the user\'s answers in mind.',
    }),
  },
};
