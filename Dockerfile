# syntax=docker/dockerfile:1.6

FROM ubuntu:24.04 AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm install -g @anthropic-ai/claude-code
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && if ! getent group 1000 >/dev/null; then groupadd -g 1000 claudeproxy; fi \
    && if ! id -u claudeproxy >/dev/null 2>&1; then useradd -m -u 1000 -g 1000 -o -s /bin/bash claudeproxy; fi \
    && mkdir -p /data \
    && chown -R 1000:1000 /data

ENV HOME=/data \
    XDG_CONFIG_HOME=/data/.config \
    XDG_DATA_HOME=/data/.local/share \
    XDG_STATE_HOME=/data/.local/state \
    XDG_CACHE_HOME=/data/.cache \
    HOST=0.0.0.0 \
    PORT=3456

VOLUME ["/data"]
USER claudeproxy
EXPOSE 3456
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD []
