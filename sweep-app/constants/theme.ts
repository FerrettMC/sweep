// constants/theme.ts
//
// One source of truth for colour, spacing, and type. Screens import from here
// rather than hardcoding values, so they can't quietly drift apart.
//
// Coral over green (too close to Fervor) and teal (undersells the gamified
// side). Coral reads as "hot deal" and pairs with the XP/leaderboard system.
// Everything else stays neutral so the accent stays an accent.
//
// ---- on the two palettes ----
//
// Both themes define the same token names, and the tokens are named by ROLE,
// not by appearance. That's what makes a single stylesheet work in both: a
// component asks for `textPrimary`, never for "light grey".
//
// The one that trips people up is `background` used as a foreground colour —
// it's the text on a filled accent button. That reads as backwards until you
// see why it holds in both themes: text on coral wants to be whatever the page
// itself is, so it disappears into the button rather than fighting it.

export type ColorScheme = "light" | "dark";

// Not `as const`: the literal types would make every hex its own type, and the
// light palette could then never satisfy the same shape.
const dark = {
  background: "#0D0D0D",
  surface: "#1A1A1A",
  surfaceRaised: "#232323",
  surfaceBorder: "#2A2A2A",

  // Primary coral ramp.
  accent: "#D85A30",
  accentPressed: "#B4491F",
  accentFill: "#FAECE7", // light fill, for badges on light surfaces
  accentDeep: "#712B13", // text on accentFill
  // Coral at low opacity, for tinted backgrounds on the dark theme.
  accentMuted: "#4A2A1F",

  textPrimary: "#F5F5F5",
  textSecondary: "#999999",
  textTertiary: "#6B6B6B",

  success: "#3DA35D", // a price drop
  danger: "#E5484D", // a price rise, or an error
  warning: "#E0A030", // a degraded retailer

  // Tinted backgrounds for status chips and banners, with the text colour that
  // reads on them. Can't be derived by fading the base colour — a translucent
  // red over black and over white land in completely different places.
  successMuted: "#1E3A28",
  dangerMuted: "#3A1A1C",
  dangerOn: "#FFD7D9",

  // Scrims and shadows, which can't be a flat colour in both themes.
  scrim: "rgba(0,0,0,0.6)",
  scrimStrong: "rgba(0,0,0,0.7)",

  // Retailer accents, used for the small source badges in compiled search.
  retailers: {
    amazon: "#FF9900",
    walmart: "#0071DC",
    bestbuy: "#FFE000",
    ebay: "#E53238",
    newegg: "#E87F1E",
    // ASOS brands in black, which is invisible on a dark background — use a
    // near-white so the store dot still reads.
    asos: "#EDEDED",
    etsy: "#F1641E",
  },
};

const light: Palette = {
  background: "#FFFFFF",
  surface: "#F7F7F8",
  surfaceRaised: "#EDEDEF",
  surfaceBorder: "#E0E0E3",

  // Coral darkened slightly. The dark-theme coral is tuned to glow against
  // near-black; on white it's bright enough to fail contrast on small text.
  accent: "#C24A22",
  accentPressed: "#9E3A19",
  accentFill: "#FAECE7",
  accentDeep: "#712B13",
  accentMuted: "#FBE7DF",

  textPrimary: "#141416",
  textSecondary: "#5C5C63",
  textTertiary: "#8A8A93",

  // All three darkened for contrast against white. The dark-theme versions are
  // pitched for a black background and go muddy on a light one.
  success: "#2E7D46",
  danger: "#C4292E",
  warning: "#9A6A12",

  successMuted: "#DFF3E6",
  dangerMuted: "#FDE8E9",
  dangerOn: "#8E1D21",

  scrim: "rgba(0,0,0,0.35)",
  scrimStrong: "rgba(0,0,0,0.45)",

  retailers: {
    amazon: "#B36B00",
    walmart: "#0071DC",
    // Best Buy's yellow is invisible on white — darken to a readable gold.
    bestbuy: "#9A8500",
    ebay: "#C4292E",
    newegg: "#C2650F",
    // The mirror of the dark-theme note: ASOS brands in black, which works
    // here, so the near-white substitution is reverted.
    asos: "#141416",
    etsy: "#F1641E",
  },
};

/** The shape every screen's stylesheet is written against. */
export type Palette = typeof dark;

export const palettes = { dark, light } as const;

/**
 * The dark palette, for the few places that run outside React and so can't
 * read the provider — the splash screen and the static nav theme in
 * app/_layout.tsx. Anything inside a component should use `useTheme()`.
 */
export const colors = dark;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const type = {
  display: { fontSize: 34, fontWeight: "900" },
  title: { fontSize: 24, fontWeight: "800" },
  heading: { fontSize: 18, fontWeight: "700" },
  body: { fontSize: 15, fontWeight: "500" },
  label: { fontSize: 13, fontWeight: "600" },
  caption: { fontSize: 11, fontWeight: "600" },
} as const;
