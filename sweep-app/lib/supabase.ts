// lib/supabase.ts
//
// The auth client.
//
// URL and key come from the environment so a build can be pointed at a
// different Supabase project — a scratch one for development, so tests and
// manual poking stop writing to the database real users are on.
//
// Note what is and isn't secret here. The publishable key is designed to ship
// inside the client: it grants only what RLS and GoTrue allow an anonymous
// caller, and it is readable in the AAB whatever we do. Moving it to env buys
// configurability, not secrecy — the service-role key is the one that must
// never appear in this project, and it doesn't.
//
// Values are mirrored into eas.json because .env is gitignored and EAS builds
// from the git archive, so an env-only value would be undefined in a release.
// The literals below are the last line of defence: a missing variable degrades
// to the known-good project rather than shipping an app that cannot sign
// anybody in.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://qldyjqrtfuraxvhsslrz.supabase.co";
const FALLBACK_KEY = "sb_publishable_Yt8O0ZIvcZ3tP7uoMHjybw_l4YOnZFF";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? FALLBACK_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? FALLBACK_KEY;

if (__DEV__ && !process.env.EXPO_PUBLIC_SUPABASE_URL) {
  console.warn(
    "[supabase] EXPO_PUBLIC_SUPABASE_URL is unset — using the built-in project. " +
      "Add it to .env (local) and eas.json (builds).",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
