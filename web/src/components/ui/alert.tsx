import { AlertCircle } from "lucide-react";
import { type HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/** Inline error/notice banner. */
export function Alert({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2.5 text-sm",
        "border-[color-mix(in_srgb,var(--destructive)_40%,var(--border))] bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] text-destructive",
        className,
      )}
      {...props}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
