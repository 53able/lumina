import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border-2 px-2 py-0.5 text-xs font-bold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-primary-dark/20 dark:aria-invalid:ring-primary-dark/40 aria-invalid:border-primary-dark transition-all duration-300 overflow-hidden hover:scale-110 hover:shadow-lg hover:shadow-primary/20",
  {
    variants: {
      variant: {
        default: "border-primary/30 bg-primary text-primary-foreground [a&]:hover:bg-primary/90 hover:border-primary/50",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-primary-dark/30 bg-primary-dark text-primary-foreground [a&]:hover:bg-primary-dark/90 focus-visible:ring-primary-dark/20 dark:focus-visible:ring-primary-dark/40 dark:bg-primary-dark/80 hover:border-primary-dark/50",
        outline: "border-primary/30 text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground hover:border-primary/50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
