# Chronicle: the client (Vite → dist/) and its server (esbuild → dist-server/),
# served by one dependency-free Node process on port 80.
#
# The base image is pinned by DIGEST, not just a tag: a tag can move between
# builds, a digest cannot. Re-resolve it deliberately when bumping Node:
#
#   docker pull node:24-alpine
#   docker inspect --format='{{index .RepoDigests 0}}' node:24-alpine
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Typecheck and tests already ran in CI before this deploy was sent; the
# server-side build only has to produce the artifacts. BUILD_ID is computed
# from the sources here because the runtime image carries none to hash.
RUN npm run build:client && npm run build:server && node server/buildid.mjs > dist-server/BUILD_ID

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data \
    TRUST_PROXY=true
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 80
# node:sqlite still prints an ExperimentalWarning on every start; it is the
# only warning of that kind this process can produce.
CMD ["node", "--enable-source-maps", "--disable-warning=ExperimentalWarning", "dist-server/main.mjs"]
