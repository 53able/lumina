import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm transition-all duration-300 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-primary-dark/20 dark:aria-invalid:ring-primary-dark/40 aria-invalid:border-primary-dark hover:scale-110 hover:rotate-1 active:scale-90 active:rotate-[-1deg] relative overflow-hidden glow-effect",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30",
        destructive:
          "bg-primary-dark text-primary-foreground hover:bg-primary-dark/90 focus-visible:ring-primary-dark/20 dark:focus-visible:ring-primary-dark/40 dark:bg-primary-dark/80 hover:shadow-lg hover:shadow-primary-dark/30",
        outline:
          "border-2 border-primary/30 bg-background shadow-xs hover:bg-accent hover:text-accent-foreground hover:border-primary/50 dark:bg-input/30 dark:border-primary/20 dark:hover:bg-input/50 hover:shadow-lg hover:shadow-primary/20",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-md",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 hover:shadow-sm",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary-light",
      },
      size: {
        default:
          "h-12 px-6 py-4 has-[>svg]:px-4 min-h-[48px] min-w-[48px]" /* ターゲットサイズ48×48px以上、パディング16px以上 */,
        sm: "h-10 rounded-md gap-1.5 px-4 py-3 has-[>svg]:px-3 min-h-[40px] min-w-[40px]" /* 最小サイズ40px */,
        lg: "h-12 rounded-md px-6 py-4 has-[>svg]:px-4 min-h-[48px] min-w-[48px]" /* ターゲットサイズ48×48px以上 */,
        icon: "size-12 min-h-[48px] min-w-[48px]" /* ターゲットサイズ48×48px以上 */,
        "icon-sm": "size-10 min-h-[40px] min-w-[40px]" /* 最小サイズ40px */,
        "icon-lg": "size-12 min-h-[48px] min-w-[48px]" /* ターゲットサイズ48×48px以上 */,
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
