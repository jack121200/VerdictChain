/** Joins class names, skipping falsy entries. Class strings stay literal so Tailwind can see them. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
