// routes/assets.ts
//
// The handful of static files the public pages need.
//
// A route rather than a static-file middleware: there are two of them, they
// never change without a deploy, and adding a plugin to serve a directory is
// more surface than the problem deserves. It also means the cache headers are
// written here, where they can be read, instead of inherited from a default.
//
// The files must be COPY'd in the Dockerfile — nothing imports them, so a
// bundler-shaped assumption that they'll come along is exactly how they end up
// 404ing in production while working locally.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * Resolved from the working directory, which is /app in the container and the
 * package root in development — both of which hold assets/ directly.
 */
const ASSET_DIR = join(process.cwd(), "assets");

/** Only these. A filename from the URL should never reach the filesystem. */
const FILES: Record<string, { file: string; type: string }> = {
  "hero.webp": { file: "hero.webp", type: "image/webp" },
  "hero.png": { file: "hero.png", type: "image/png" },
};

/** Immutable in practice: the content changes only with a deploy. */
const CACHE = "public, max-age=604800, immutable";

const memory = new Map<string, Buffer>();

export async function assetRoutes(app: FastifyInstance) {
  app.get("/assets/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    const entry = FILES[name];
    if (!entry) return reply.status(404).send({ error: "Not found" });

    let body = memory.get(name);
    if (!body) {
      try {
        body = await readFile(join(ASSET_DIR, entry.file));
        memory.set(name, body);
      } catch {
        // Missing on disk means the deploy didn't carry it. Say so in the log
        // rather than only in a broken image on someone's screen.
        request.log.error({ asset: name, dir: ASSET_DIR }, "asset missing from the image");
        return reply.status(404).send({ error: "Not found" });
      }
    }

    reply.header("content-type", entry.type);
    reply.header("cache-control", CACHE);
    return reply.send(body);
  });
}
