import { RotateCw } from "lucide-react";
import { useMutation } from "@connectrpc/connect-query";
import { restartCore } from "../gen/panel-PanelService_connectquery";
import { cn } from "../lib/utils";
import { AsyncActionButton } from "./AsyncActionButton";
import { type ButtonProps } from "./ui/button";

interface RestartCoreButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  /** Called after a successful restart (e.g. to refetch status). */
  onRestarted?: () => void;
}

/** Restarts the Hysteria core via the panel API, with confirm + toast + spinner. */
export function RestartCoreButton({ onRestarted, ...props }: RestartCoreButtonProps) {
  // The Stats dashboard runs off the StreamServerStats live stream, so it picks
  // up the new running-state / version on its next tick — nothing to invalidate.
  const restart = useMutation(restartCore);
  return (
    <AsyncActionButton
      action={() => restart.mutateAsync({})}
      successMessage="Core restarted"
      onDone={onRestarted}
      renderIcon={(busy) => <RotateCw className={cn("size-4", busy && "animate-spin")} />}
      confirm={{
        title: "Restart core?",
        description:
          "This restarts the Hysteria core and briefly drops all active client connections.",
        confirmLabel: "Restart core",
      }}
      {...props}
    >
      Restart core
    </AsyncActionButton>
  );
}
