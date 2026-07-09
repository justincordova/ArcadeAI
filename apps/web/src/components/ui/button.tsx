// shadcn/ui Button — copied/adapted from the canonical shadcn template.
// Uses class-variance-authority to define variants; consumers compose
// classes via `cn(buttonVariants({ variant, size }), extraClassName)`.

import { cn } from "@/lib/cn.js";
import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        // Primary CTA — brand gradient (magenta → purple → cyan). Reads from
        // --gradient-brand so it desaturates correctly in the light theme
        // instead of burning at full saturation on the cream surface.
        primary:
          "bg-[image:var(--gradient-brand)] text-white shadow-[0_2px_12px_rgba(255,62,165,0.3)] hover:opacity-90",
        // Secondary — outlined neutral.
        secondary:
          "border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] hover:border-[rgba(255,62,165,0.5)]",
        // Ghost — text only, hover background.
        ghost:
          "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
        // Destructive — red gradient for delete/danger actions.
        destructive: "bg-gradient-to-br from-[#b91c1c] to-[#f43f5e] text-white hover:opacity-90",
        // Outline destructive — for danger actions that need lower visual weight.
        "destructive-outline":
          "border border-[rgba(244,63,94,0.3)] bg-transparent text-[var(--color-danger)] hover:bg-[rgba(244,63,94,0.08)]",
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-5 text-sm",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
