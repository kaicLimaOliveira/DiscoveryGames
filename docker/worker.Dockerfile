# syntax=docker/dockerfile:1
# Contexto de build: raiz do repositório. Alvos: `runtime` (padrão) e `migrate`.
FROM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/platforms/package.json packages/platforms/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# O tsup embute o código TS dos pacotes do workspace (inclusive o cliente Prisma gerado).
RUN pnpm --filter @central/db generate \
 && pnpm --filter @central/worker build \
 && pnpm --filter @central/worker deploy --prod --legacy /out \
 && cp -r apps/worker/dist /out/dist \
 # Os pacotes @central/* já estão embutidos no dist; a CLI do prisma (peer do @prisma/client),
 # o studio e o typescript só servem à migrate/dev e não são carregados em runtime.
 && cd /out/node_modules/.pnpm \
 && rm -rf /out/node_modules/@central prisma@* @prisma+studio-core@* @prisma+dev@* typescript@* effect@* @electric-sql+pglite@*

# Só roda `prisma migrate deploy`: imagem enxuta com a CLI do prisma (versão fixada, igual à do
# lockfile) e o diretório prisma/ do @central/db; não parte do estágio `build`.
FROM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS migrate
# O schema engine do Prisma precisa do OpenSSL (ausente no node:24-slim).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
RUN echo '{"name":"migrate","private":true,"dependencies":{"prisma":"7.10.1"}}' > package.json \
 && npm install --omit=dev --no-audit --no-fund \
 # Baixa o schema engine (OpenSSL 3) no build: o usuário node não pode gravar em node_modules.
 && ./node_modules/.bin/prisma -v \
 && rm -rf /root/.npm /root/.cache /tmp/*
COPY packages/db/prisma.config.ts ./
COPY packages/db/prisma ./prisma
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/package.json ./package.json
USER node
CMD ["node", "dist/main.js"]
