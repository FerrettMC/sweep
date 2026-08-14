# Build for the Sweep backend, from the repository root.
#
# Lives in sweep-backend/ because that is what Railway's Root Directory points
# at, and the build context is therefore this folder — not the repo root. Paths
# below are relative to it.
#
# Getting here took two wrong turns worth recording. First the Root Directory
# setting hadn't saved, so the analyzer inspected the repo root, found three
# folders and no package.json, and failed. Then the Dockerfile was moved to the
# repo root to sidestep that — but by then the setting HAD applied, so the
# context was sweep-backend/ while the COPY paths still said sweep-backend/...,
# and the build failed on "/sweep-backend/src: not found".
#
# node:22 (full Debian) rather than -slim or -alpine. It already carries the
# openssl Prisma needs, so there is no apt-get step to fail, and it avoids the
# musl engine-binary problems Alpine has with Prisma. The image is larger; for
# one small service that costs nothing that matters.

FROM node:22 AS build
WORKDIR /app

# Dependencies first, so a source-only change doesn't reinstall them.
# The postinstall hook runs `prisma generate`, which needs the schema present.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
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
COPY package*.json ./

# Railway provides PORT; the app falls back to 3001 when it doesn't.
EXPOSE 3001

# Migrations run at start rather than at build: the build has no database
# credentials, and this way a rollback redeploys a matching schema.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
