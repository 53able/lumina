import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind CSSクラス名をマージするユーティリティ
 * @param inputs - マージするクラス名
 * @returns マージされたクラス名
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
