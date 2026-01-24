import type * as React from "react";

import { cn } from "../../lib/utils.js";

/**
 * Label コンポーネント
 *
 * フォーム要素に関連付けるラベル
 */
const Label = ({ className, ...props }: React.ComponentProps<"label">) => {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed via props at usage site
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm font-medium leading-none select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
};

export { Label };
