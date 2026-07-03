import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-muted-bg text-muted",
        on: "bg-[color-mix(in_srgb,var(--ok)_18%,transparent)] text-ok",
        off: "bg-[color-mix(in_srgb,var(--destructive)_18%,transparent)] text-destructive",
        warn: "bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-warning",
        accent: "bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] text-primary",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
