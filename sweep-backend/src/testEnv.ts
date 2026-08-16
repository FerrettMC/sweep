// src/testEnv.ts — the first import of every test file.
//
// Tests create users, delete users, and purge stray accounts. Until now they
// did all of that in the same Supabase project real people use. That was
// survivable while the only account was the developer's own; it stopped being
// survivable the day a dozen testers signed up, because a cleanup routine that
// pattern-matches slightly too broadly deletes somebody's real data.
//
// Two things happen here.
//
// `.env.test` is loaded ahead of `.env`, so a dev project overrides production
// without editing the file the server uses.
//
// Then it refuses to run at all if the target still looks like production.
// Configuration alone is not enough: the failure mode is *forgetting*, and a
// guard that depends on remembering is the same guard that was missing. This
// one fails loudly before a single row is touched.

import { config } from "dotenv";

// .env.test wins where it defines something; .env fills in the rest, so a dev
// project only has to override the handful of values that differ.
config({ path: ".env.test" });
config();

/**
 * The live project. Hardcoded on purpose — reading it from the environment
 * would let the same mistake that points tests at production also disable the
 * check that catches it.
 */
const PRODUCTION_REF = "qldyjqrtfuraxvhsslrz";

function looksLikeProduction(): string | null {
  const supabase = process.env.SUPABASE_URL ?? "";
  const database = process.env.DATABASE_URL ?? "";
  const direct = process.env.DIRECT_URL ?? "";

  if (supabase.includes(PRODUCTION_REF)) return "SUPABASE_URL";
  if (database.includes(PRODUCTION_REF)) return "DATABASE_URL";
  if (direct.includes(PRODUCTION_REF)) return "DIRECT_URL";
  return null;
}

/**
 * Call before touching anything. Throws unless the target is a dev project.
 *
 * The escape hatch exists because a few checks genuinely have to run against
 * production — verifying a deployed endpoint, say — but it has to be typed out
 * deliberately, which is the whole point.
 */
export function assertNotProduction(): void {
  if (process.env.ALLOW_PRODUCTION_TESTS === "yes-really") {
    console.warn(
      "⚠️  ALLOW_PRODUCTION_TESTS is set — this run will write to the live database.",
    );
    return;
  }

  const offender = looksLikeProduction();
  if (!offender) return;

  throw new Error(
    [
      "",
      "Refusing to run: tests are pointed at the production project.",
      "",
      `  ${offender} contains ${PRODUCTION_REF}`,
      "",
      "These tests create and delete users. Real people have accounts there.",
      "",
      "Fix it by creating sweep-backend/.env.test with the dev project's",
      "SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_ANON_KEY, DATABASE_URL and",
      "DIRECT_URL. See DEPLOY.md.",
      "",
      "If you genuinely meant production, set ALLOW_PRODUCTION_TESTS=yes-really.",
      "",
    ].join("\n"),
  );
}

/** Which project this run is actually pointed at, for the header of a test. */
export function targetSummary(): string {
  const ref = (process.env.SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\./)?.[1];
  if (!ref) return "no SUPABASE_URL set";
  return ref === PRODUCTION_REF ? `${ref} (PRODUCTION)` : `${ref} (dev)`;
}
