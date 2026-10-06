/**
 * Typesetting style: the one place lettering defaults and per-segment overrides are defined.
 * Client-safe (no server imports) so the translation workspace can edit the same shape the renderer reads.
 */
import { z } from 'zod';

export const TYPESET_FONTS = ['shonen', 'noto-sans'] as const;
export type TypesetFontName = (typeof TYPESET_FONTS)[number];
export const FONT_LABEL: Record<TypesetFontName, string> = { shonen: 'Shonen (comic)', 'noto-sans': 'Noto Sans' };

export type TypesetStyle = {
  fontFamily: TypesetFontName;
  /** Preferred size in page pixels; null = match the original lettering and shrink to fit. */
  fontSize: number | null;
  minFontSize: number;
  maxFontSize: number;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  /** Extra space between letters, in em. */
  letterSpacing: number;
  /** Text colour; null = use the colour of the original lettering. */
  color: string | null;
  strokeColor: string | null;
  /** Outline width as a fraction of the font size (0 = none; free text on busy art gets one automatically). */
  strokeWidth: number;
  shadow: boolean;
  shadowColor: string;
  /** Horizontal padding inside a balloon, as a fraction of its width. */
  padding: number;
  /** Nudge the text block, in page pixels. */
  offsetX: number;
  offsetY: number;
};

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb colour');

/** Overrides an admin may store on a segment. Every field is optional; unknown keys are rejected. */
export const typesetStyleOverride = z.object({
  fontFamily: z.enum(TYPESET_FONTS),
  fontSize: z.number().int().min(6).max(400).nullable(),
  minFontSize: z.number().int().min(6).max(200),
  maxFontSize: z.number().int().min(8).max(400),
  bold: z.boolean(),
  italic: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  lineHeight: z.number().min(0.8).max(2.5),
  letterSpacing: z.number().min(-0.1).max(0.5),
  color: hexColor.nullable(),
  strokeColor: hexColor.nullable(),
  strokeWidth: z.number().min(0).max(0.5),
  shadow: z.boolean(),
  shadowColor: hexColor,
  padding: z.number().min(0).max(0.4),
  offsetX: z.number().int().min(-2000).max(2000),
  offsetY: z.number().int().min(-2000).max(2000),
}).partial().strict();
export type TypesetStyleOverride = z.infer<typeof typesetStyleOverride>;

/** Defaults tuned for manhwa dialogue: comic font, centred, auto-sized to the original lettering. */
export const DEFAULT_TYPESET_STYLE: TypesetStyle = {
  fontFamily: 'shonen', fontSize: null, minFontSize: 12, maxFontSize: 36, bold: false, italic: false,
  align: 'center', verticalAlign: 'middle', lineHeight: 1.18, letterSpacing: 0, color: null,
  strokeColor: null, strokeWidth: 0, shadow: false, shadowColor: '#000000', padding: 0.1, offsetX: 0, offsetY: 0,
};

/** Base style with stored overrides applied; invalid stored values are ignored rather than breaking a render. */
export function resolveStyle(base: TypesetStyle, ...overrides: (Record<string, unknown> | null | undefined)[]): TypesetStyle {
  let style = { ...base };
  for (const override of overrides) {
    if (!override) continue;
    const parsed = typesetStyleOverride.safeParse(override);
    if (parsed.success) style = { ...style, ...parsed.data };
  }
  if (style.minFontSize > style.maxFontSize) style.minFontSize = style.maxFontSize;
  return style;
}
