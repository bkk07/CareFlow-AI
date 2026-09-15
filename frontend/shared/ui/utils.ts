/**
 * Minimal `cn()` utility in the shadcn position (`frontend/shared/ui`).
 *
 * Full shadcn init output (components.json, Button, etc. with
 * tailwind-merge + clsx + radix deps) will be added when Phase 3 needs
 * real table/form screens. Phase 0 only needs the directory + import
 * path to exist so later phases don't rewire imports.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
