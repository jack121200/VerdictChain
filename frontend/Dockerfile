# VerdictChain console image: builds the Vite app, then serves the build with `vite preview`.
# Build context is ./frontend:  docker compose --profile app build frontend
#                         or:  docker build -t verdictchain-frontend frontend
FROM node:22-slim

# The BROWSER calls the API, not this container, so this is an address the browser can reach. Vite compiles it
# into the bundle (src/api/client.ts reads import.meta.env.VITE_API_BASE), so changing it needs a rebuild.
ARG VITE_API_BASE=http://127.0.0.1:8000
# frontend/package.json has no "packageManager" field, so pin the pnpm release here. Keep it in step with CI.
ARG PNPM_VERSION=12.3.4

RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app

# Dependencies first, so a source change does not reinstall them.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Run as the unprivileged `node` user. vite is called directly: `pnpm exec` would make corepack download pnpm again
# for this user at start-up. vite writes its bundled config to node_modules/.vite-temp, so that one directory
# must be writable.
RUN mkdir -p node_modules/.vite-temp && chown node:node node_modules/.vite-temp
USER node

EXPOSE 5173

CMD ["./node_modules/.bin/vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
