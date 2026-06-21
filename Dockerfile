FROM node:20-slim AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Production image — only prod deps (tsx runs the server directly; vite/react/
# typescript are build-time only and dropped by --prod).
FROM node:20-slim
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

COPY src ./src
COPY --from=builder /app/dist ./dist

EXPOSE 6720
ENV NODE_ENV=production
ENV PORT=6720

VOLUME ["/app/data"]

CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
