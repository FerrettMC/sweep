# Build for the Sweep backend, from the repository root.
#
# Lives at the root rather than in sweep-backend/ on purpose. This is a
# monorepo, and Railway's "Root Directory" setting was not being applied to the
# build — the analyzer kept inspecting the repo root, finding three folders and
# no package.json, and giving up. A Dockerfile removes the guesswork entirely:
# the build no longer depends on a platform setting behaving as documented.
#
# Because the build context is the repo root, every COPY is written relative to
# it. Only sweep-backend is copied; the Expo app is not part of the server image.
#
# node:22 (full Debian) rather than -slim or -alpine. It already carries the
# openssl Prisma needs, so there is no apt-get step to fail, and it avoids the
# musl engine-binary problems Alpine has with Prisma. The image is larger; for
# one small service that costs nothing that matters.

FROM node:22 AS build
WORKDIR /app

# Dependencies first, so a source-only change doesn't reinstall them.
# The postinstall hook runs `prisma generate`, which needs the schema present.
COPY sweep-backend/package*.json ./
COPY sweep-backend/prisma ./prisma
RUN npm ci

COPY sweep-backend/tsconfig.json ./
COPY sweep-backend/src ./src
RUN npm run build

# ---- runtime ----
FROM node:22
WORKDIR /app
ENV NODE_ENV=production

# node_modules comes from the build stage because it already holds the
# generated Prisma client. The prisma CLI is a normal dependency here, so
# `migrate deploy` works at start-up without dev dependencies.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY sweep-backend/package*.json ./

# Railway provides PORT; the app falls back to 3001 when it doesn't.
EXPOSE 3001

# Migrations run at start rather than at build: the build has no database
# credentials, and this way a rollback redeploys a matching schema.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
