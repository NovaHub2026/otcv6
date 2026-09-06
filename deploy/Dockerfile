# The OTC market engine, built from this tree (PH-30.1).
#
#   docker build -f deploy/Dockerfile -t otc-engine .
#   docker run -e OTC_MASTER_SECRET=... -v otc-state:/var/lib/otc -p 3000:3000 otc-engine
FROM node:24-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY tools/sim ./tools/sim
RUN npm ci --no-audit --no-fund && npm run build

FROM node:24-slim
ENV NODE_ENV=production PORT=3000 OTC_BIND=0.0.0.0 OTC_STATE_DIR=/var/lib/otc
WORKDIR /opt/otc
COPY --from=build /src /opt/otc
RUN useradd --system --home /opt/otc otc && mkdir -p /var/lib/otc && chown -R otc /var/lib/otc
USER otc
VOLUME ["/var/lib/otc"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "apps/api/dist/main.js"]
