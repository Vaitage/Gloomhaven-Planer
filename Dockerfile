# Stufe 1: Spieldaten aus Gloomhaven Secretariat holen und aufbereiten.
# Die Daten liegen nicht im Repo, sie werden bei jedem Build frisch geholt.
FROM node:22-alpine AS daten
RUN apk add --no-cache git
# Fester Stand von GHS, gegen den der Import getestet ist. Für neuere Daten
# beim Build überschreiben: docker compose build --build-arg GHS_REF=<commit>
ARG GHS_REF=97b2f965e613bd3ad7e45bd9f57f478eb37058c0
WORKDIR /build
RUN git init -q ghs && cd ghs \
 && git remote add origin https://github.com/Lurkars/gloomhavensecretariat.git \
 && git sparse-checkout set data/gh src/assets/locales \
 && git fetch -q --depth 1 --filter=blob:none origin "$GHS_REF" \
 && git checkout -q FETCH_HEAD
COPY scripts ./scripts
RUN node scripts/import-data.mjs ghs /build/gamedata.json

# Stufe 2: die eigentliche App, ohne zusätzliche Pakete
FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
COPY --from=daten /build/gamedata.json /app/gamedata/gamedata.json
RUN mkdir -p /data && chown node:node /data
ENV GAMEDATA=/app/gamedata/gamedata.json DATA_DIR=/data PORT=8090 NODE_ENV=production
VOLUME /data
EXPOSE 8090
USER node
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1
CMD ["node", "server.mjs"]
