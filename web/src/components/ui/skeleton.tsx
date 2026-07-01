import { type HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted-bg",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.5s_infinite] after:bg-gradient-to-r after:from-transparent after:via-border after:to-transparent",
        className,
      )}
      {...props}
    />
  );
}
