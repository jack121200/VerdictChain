/**
 * The one list of Material Symbols Outlined glyphs the console may render.
 *
 * vite.config.ts injects this list into the Google Fonts `icon_names` subset in
 * index.html, and the Icon component only accepts names from it. Add a glyph here
 * and nowhere else. The list holds exactly the glyphs in use, plus the status shapes
 * from SKILL-design-system section 4 (warning, error, check, verified_user).
 */
export const ICON_NAMES = [
  'admin_panel_settings',
  'check',
  'check_circle',
  'close',
  'content_copy',
  'dashboard',
  'error',
  'hub',
  'info',
  'logout',
  'menu',
  'menu_book',
  'receipt_long',
  'sync_alt',
  'travel_explore',
  'verified_user',
  'warning',
] as const;

export type IconName = (typeof ICON_NAMES)[number];
