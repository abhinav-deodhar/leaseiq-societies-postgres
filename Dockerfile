FROM node:24-trixie-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:24-trixie-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DOCUMENT_CLAMSCAN_PATH=/app/scripts/scan-document.sh

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates clamav clamav-freshclam tini util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/clamav \
    && chown -R node:node /var/lib/clamav

COPY --from=build --chown=node:node /app /app

RUN chmod 755 /app/scripts/start-railway.sh /app/scripts/scan-document.sh \
    && clamscan --help | grep -q -- '--fail-if-cvd-older-than'

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/bin/sh", "/app/scripts/start-railway.sh"]
