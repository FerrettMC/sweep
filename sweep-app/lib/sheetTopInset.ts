// lib/sheetTopInset.ts
//
// How far a top-anchored sheet must sit from the top of the screen.
//
// Not useSafeAreaInsets, which is what the first attempt at this used and why
// it changed nothing. A React Native Modal is its own native window on Android,
// and react-native-safe-area-context measures per window — so inside a Modal
// the hook can hand back a top inset of 0 even though the status bar is very
// much still there. Adding 0 to the padding produced a fix that compiled,
// looked right in review, and moved the sheet not one pixel.
//
// StatusBar.currentHeight is the real measured height of the Android status bar
// and needs no provider, no context and no native window of its own. On iOS it
// is undefined, so the safe-area inset is used there, where it works properly.

import { Platform, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * A floor for Android, in case StatusBar.currentHeight is somehow unset.
 *
 * 24dp is the long-standing Android status bar height. Overshooting by a few
 * points costs a little whitespace; undershooting puts a sheet on top of the
 * clock, which is the bug this exists for.
 */
const ANDROID_FALLBACK = 24;

export function useSheetTopInset(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS === "android") {
    return StatusBar.currentHeight ?? Math.max(insets.top, ANDROID_FALLBACK);
  }
  return insets.top;
}
