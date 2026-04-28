# Build stage: build the Astro site against the production PocketBase URL.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
ARG PUBLIC_PB_URL
ENV PUBLIC_PB_URL=$PUBLIC_PB_URL
# Astro outputs to ../pocketbase/pb_public by default; override here for the
# isolated build stage.
RUN npm run build -- --outDir /out

# Runtime stage: PocketBase binary + migrations + hooks + built static site.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates curl unzip && update-ca-certificates

ARG PB_VERSION=0.22.21
ARG TARGETARCH=amd64
RUN curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -o /tmp/pb.zip \
  && unzip /tmp/pb.zip -d /pb \
  && rm /tmp/pb.zip \
  && chmod +x /pb/pocketbase

WORKDIR /pb
COPY pocketbase/pb_migrations ./pb_migrations
COPY pocketbase/pb_hooks ./pb_hooks
COPY --from=web /out ./pb_public

EXPOSE 8090
VOLUME ["/pb/pb_data"]
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
