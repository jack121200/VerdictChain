/** Shared utility strings. Kept literal so Tailwind's source scan finds every class. */

/** Colour roles from SKILL-design-system section 3. */
export type Tone = 'primary' | 'secondary' | 'tertiary' | 'error';

export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * The border of a control that has no text label of its own (a text input, a select): its edge is what tells a reader
 * where it is, so it must reach 3:1 against the surface around it (WCAG 1.4.11). outline-variant, the card-border
 * colour, measures 1.4 to 1.7:1 there (scripts/contrast-check.mjs); outline measures 5.4 to 6.6.
 */
export const CONTROL_BORDER = 'border border-outline';
