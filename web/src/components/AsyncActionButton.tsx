import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export interface ConfirmConfig {
  /** Heading of the confirm dialog. */
  title: string;
  /** Body explaining the consequences of the action. */
  description: ReactNode;
  /** Label for the confirming button (default "Continue"). */
  confirmLabel?: string;
  /** Visual emphasis of the confirm button (default "destructive"). */
  confirmVariant?: ButtonProps["variant"];
}

interface AsyncActionButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  /** The async work to run. A thrown error surfaces an error toast. */
  action: () => Promise<unknown>;
  /** Toast shown on success; receives the resolved value. */
  successMessage?: string | ((result: unknown) => string);
  /** Called after a successful action (e.g. to refetch state). */
  onDone?: () => void;
  /** Optional leading icon; receives the busy state so it can animate. */
  renderIcon?: (busy: boolean) => ReactNode;
  /** Button label. */
  children?: ReactNode;
  /** Label shown while the action is running (defaults to `children`). */
  busyLabel?: ReactNode;
  /** When set, clicking opens a confirm dialog before running the action. */
  confirm?: ConfirmConfig;
}

/**
 * A button that runs an async action with a spinner, success/error toasts, and
 * an optional confirmation dialog for destructive or privileged operations.
 */
export function AsyncActionButton({
  action,
  successMessage,
  onDone,
  renderIcon,
  children,
  busyLabel,
  confirm,
  ...props
}: AsyncActionButtonProps) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const result = await action();
      if (successMessage) {
        toast.success(
          typeof successMessage === "function" ? successMessage(result) : successMessage,
        );
      }
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onClick() {
    if (confirm) {
      setConfirmOpen(true);
    } else {
      void run();
    }
  }

  const label = busy && busyLabel !== undefined ? busyLabel : children;

  return (
    <>
      <Button onClick={onClick} disabled={busy} {...props}>
        {renderIcon?.(busy)}
        {label}
      </Button>

      {confirm && (
        <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{confirm.title}</DialogTitle>
              <DialogDescription>{confirm.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DialogClose>
              <Button
                variant={confirm.confirmVariant ?? "destructive"}
                onClick={() => {
                  setConfirmOpen(false);
                  void run();
                }}
              >
                {confirm.confirmLabel ?? "Continue"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
