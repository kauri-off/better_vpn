import { Download } from "lucide-react";
import { useMutation } from "@connectrpc/connect-query";
import { updateCore } from "../gen/panel-PanelService_connectquery";
import { cn } from "../lib/utils";
import { AsyncActionButton } from "./AsyncActionButton";
import { type ButtonProps } from "./ui/button";

interface UpdateCoreButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  /** Called after a successful update (e.g. to refetch status). */
  onUpdated?: () => void;
}

/**
 * Downloads the latest Hysteria core release, replaces the binary, and restarts
 * it — via the panel API, with confirm + toast + spinner.
 */
export function UpdateCoreButton({ onUpdated, ...props }: UpdateCoreButtonProps) {
  // The Stats dashboard runs off the StreamServerStats live stream, so it picks
  // up the new version / running-state on its next tick — nothing to invalidate.
  const update = useMutation(updateCore);
  return (
    <AsyncActionButton
      action={() => update.mutateAsync({})}
      successMessage={(result) => {
        const version = (result as { version?: string }).version;
        return version ? `Core updated to ${version}` : "Core updated";
      }}
      onDone={onUpdated}
      renderIcon={(busy) => <Download className={cn("size-4", busy && "animate-pulse")} />}
      busyLabel="Updating…"
      confirm={{
        title: "Update core?",
        description:
          "This downloads the latest Hysteria release, replaces the running binary, and restarts the core — dropping all active client connections.",
        confirmLabel: "Update core",
      }}
      {...props}
    >
      Update core
    </AsyncActionButton>
  );
}
