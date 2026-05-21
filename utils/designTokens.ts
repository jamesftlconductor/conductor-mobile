// Design tokens — the standard values every screen should reach for.
// Settings is the reference standard; this file extracts its values
// so other screens can converge without copy-pasting magic numbers.
//
// Tokens are pure values (no theme dependency). The shared
// components/SectionLabel, EmptyState, and SkeletonRow primitives in
// /components consume both these tokens and theme.* colors at render
// time, so screens still flip correctly in light mode.

export const TOKENS = {
  // Cards / surfaces
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  // Section headers — 10px muted uppercase with 2pt letter spacing.
  sectionHeader: {
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
    fontWeight: '600' as const,
  },
  // List item — paddingVertical 12, paddingHorizontal 16, minHeight
  // 44 (the iOS HIG touch target), borderBottomWidth 0.5.
  listItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    borderBottomWidth: 0.5,
  },
  // Typography stack — header 22, subheader 16, body 15, secondary
  // 13, label 10. Line heights tuned for legibility at each size.
  type: {
    header:    { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 28 },
    subheader: { fontSize: 16, fontWeight: '600' as const, letterSpacing: 0,    lineHeight: 22 },
    body:      { fontSize: 15, fontWeight: '400' as const, letterSpacing: 0.1,  lineHeight: 21 },
    secondary: { fontSize: 13, fontWeight: '400' as const, letterSpacing: 0.1,  lineHeight: 18 },
    label:     { fontSize: 10, fontWeight: '600' as const, letterSpacing: 2,    lineHeight: 14 },
  },
  // Spacing scale
  space: {
    section: 24,
    item: 12,
    pad: 16,
  },
  // Loading skeleton opacity — muted rectangle, 30% on dark / 50% on
  // light. Light-mode is handled by the component, but the value is
  // captured here as a single source of truth.
  skeletonOpacity: 0.3,
};
