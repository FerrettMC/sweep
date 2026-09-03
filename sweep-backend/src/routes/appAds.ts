// routes/appAds.ts
//
// /app-ads.txt — the file AdMob looks for to prove this app is ours.
//
// It checks the "developer website" on the Play listing, fetches
// <that domain>/app-ads.txt, and expects a line naming our publisher id. Until
// it finds one, the app shows as unverified and ad serving stays limited.
//
// Two things make this fail quietly and both are worth knowing:
//
// The file must live on the domain the PLAY LISTING names, not wherever the
// app's API happens to be. If the listing says sweepshopping.com, that is the
// only place Google will look.
//
// And it must be plain text. Before this route existed the path returned the
// API's JSON 404 — a 200-shaped answer to a crawler expecting text, which reads
// as a malformed file rather than a missing one.
//
// The publisher id comes from the environment rather than being written here.
// The AdMob account has already been replaced once; the id changing should be a
// variable and a restart, not an edit and a deploy.

import type { FastifyInstance } from "fastify";

/**
 * Google's certification authority id. A fixed value, the same for every
 * publisher — not a secret and not ours to change.
 */
const GOOGLE_CERT = "f08c47fec0942fa0";

/** ADMOB_PUBLISHER_ID, tolerating a pasted "pub-" prefix or a bare id. */
function publisherId(): string | null {
  const raw = process.env.ADMOB_PUBLISHER_ID?.trim();
  if (!raw) return null;
  const id = raw.startsWith("pub-") ? raw : `pub-${raw}`;
  // Guard against a whole ca-app-pub id being pasted in: that is the APP id,
  // which is a different thing and would fail verification while looking right.
  return /^pub-\d{16}$/.test(id) ? id : null;
}

export async function appAdsRoutes(app: FastifyInstance) {
  app.get("/app-ads.txt", async (_request, reply) => {
    const publisher = publisherId();
    reply.type("text/plain; charset=utf-8");

    if (!publisher) {
      // 404 rather than an empty file. An empty app-ads.txt is a valid
      // declaration that NOBODY may sell this inventory, which is worse than
      // having none at all — it would actively block the ads we want.
      return reply.status(404).send("app-ads.txt is not configured\n");
    }

    reply.header("cache-control", "public, max-age=3600");
    return reply.send(`google.com, ${publisher}, DIRECT, ${GOOGLE_CERT}\n`);
  });
}
