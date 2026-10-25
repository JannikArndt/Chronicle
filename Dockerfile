# Chronicle: the client (Vite → dist/) and its server (esbuild → dist-server/),
# served by one dependency-free Node process on port 80.
#
# The base image is pinned by DIGEST, not just a tag: a tag can move between
# builds, a digest cannot. Dependabot proposes new digests weekly (never a new
# Node major). Resolve one deliberately with:
#
#   docker buildx imagetools inspect node:24-alpine
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
WORKDIR /app
# Exactly INPUTS in server/buildid.mjs (test/deploy-contract.test.mjs checks):
# the build id is stamped below from what is copied here, so a file the build
# needs but INPUTS does not name would change the app without changing the id.
COPY Dockerfile docker-entrypoint.sh package.json package-lock.json index.html vite.config.ts tsconfig.json ./
RUN npm ci
COPY src ./src
COPY server ./server
COPY public-data ./public-data
COPY scripts/build-server.mjs ./scripts/
# Typecheck and tests already ran in CI before this deploy was sent; the
# server-side build only has to produce the artifacts. BUILD_ID is computed
# from the sources here because the runtime image carries none to hash.
RUN npm run build:client && npm run build:server && node server/buildid.mjs > dist-server/BUILD_ID

FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
WORKDIR /app
# su-exec drops from root to node in docker-entrypoint.sh, after it has handed
# the /data volume (possibly first written by an older, root container) to node.
RUN apk add --no-cache su-exec
ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data \
    TRUST_PROXY=true
# package.json is read by dist-server/main.mjs for the version in /version.
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/version').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
# node:sqlite still prints an ExperimentalWarning on every start; it is the
# only warning of that kind this process can produce.
CMD ["node", "--enable-source-maps", "--disable-warning=ExperimentalWarning", "dist-server/main.mjs"]
