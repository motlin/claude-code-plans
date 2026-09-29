import { AlertDialog } from "@base-ui/react/alert-dialog";
import { type ReactNode, useRef } from "react";

const BUTTON_BASE_CLASS =
  "h-8 rounded-r6 px-3 text-body font-medium transition-colors focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none";

const CONFIRM_VARIANT_CLASS = {
  primary: "bg-fill-primary text-on-primary hover:bg-fill-primary-hover",
  danger: "bg-[var(--menu-danger-fill)] text-[var(--menu-on-danger)] hover:opacity-90",
} as const;

/**
 * claude.ai/code's small confirm dialog: a title, one line of body copy, and
 * [Cancel] (initial focus) beside the confirm button, which is red for
 * destructive actions.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  variant = "primary",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: string;
  variant?: keyof typeof CONFIRM_VARIANT_CLASS;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <AlertDialog.Popup
          initialFocus={cancelRef}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 p-6 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
        >
          <AlertDialog.Title className="text-[17px] leading-6 font-semibold break-words text-primary">
            {title}
          </AlertDialog.Title>
          {body !== undefined && (
            <AlertDialog.Description className="mt-2 text-body break-words text-secondary">
              {body}
            </AlertDialog.Description>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close
              ref={cancelRef}
              type="button"
              className={`${BUTTON_BASE_CLASS} border border-strong text-primary hover:bg-fill-ghost-hover`}
            >
              Cancel
            </AlertDialog.Close>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className={`${BUTTON_BASE_CLASS} ${CONFIRM_VARIANT_CLASS[variant]}`}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
