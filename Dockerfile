# App Store Screenshot Studio: the service, headless Chromium and the job database, on any host that runs a container
# (amd64 or arm64, such as Oracle Cloud's Always Free Ampere A1).
#
#   docker build -t app-store-ss-services .
#   docker run -p 8787:8787 -v ss-data:/data --env-file .env -e PUBLIC_ORIGIN=https://your.domain app-store-ss-services
#
# Paid jobs are kept in /data/jobs.sqlite and rendered images in /data/outputs: give /data a persistent volume.
# The image holds no Stellar secret key. infra/terraform deploys it to Oracle Cloud with Caddy in front for HTTPS.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npx tsc

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    JOB_DB_PATH=/data/jobs.sqlite \
    OUTPUT_DIR=/data/outputs \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Chromium's headless shell and the libraries it needs, plus Noto fonts for headlines in non-Latin scripts.
RUN npx playwright-core install --with-deps --only-shell chromium \
 && apt-get update && apt-get install -y --no-install-recommends fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rx /ms-playwright
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# A host's new volume may belong to root: started as root, the container only gives /data to the node user, then
# runs the service as node. Started as another user, it runs as that user.
ENTRYPOINT ["sh", "-c", "if [ \"$(id -u)\" = 0 ]; then chown -R node:node /data 2>/dev/null || true; exec setpriv --reuid=node --regid=node --init-groups -- \"$@\"; fi; exec \"$@\"", "sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
