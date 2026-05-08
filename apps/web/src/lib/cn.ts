// Standard shadcn/ui className combiner. Merges Tailwind classes with
// proper precedence (e.g. `cn("p-4", "p-6")` resolves to `"p-6"`).

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
