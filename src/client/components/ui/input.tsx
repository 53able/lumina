import type * as React from "react";

import { cn } from "../../lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-12 w-full min-w-0 rounded-lg border-2 bg-transparent px-4 py-2 text-base shadow-lg transition-all duration-300 ease-out outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-primary focus-visible:ring-primary/50 focus-visible:ring-[4px] focus-visible:scale-[1.03] focus-visible:shadow-xl focus-visible:shadow-primary/30 focus-visible:animate-input-focus",
        "hover:border-primary/50 hover:shadow-md hover:shadow-primary/10",
        "aria-invalid:ring-primary-dark/20 dark:aria-invalid:ring-primary-dark/40 aria-invalid:border-primary-dark",
        className
      )}
      {...props}
    />
  );
}

export { Input };
