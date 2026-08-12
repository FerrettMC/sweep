// constants/theme.ts
//
// One source of truth for colour, spacing, and type. Screens import from here
// rather than hardcoding values, so they can't quietly drift apart.
//
// Coral over green (too close to Fervor) and teal (undersells the gamified
// side). Coral reads as "hot deal" and pairs with the XP/leaderboard system.
// Everything else stays neutral so the accent stays an accent.

export const colors = {
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
  },
} as const;

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
