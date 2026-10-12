# Immagine di Athenai: compila l'app web e la fa servire dal server (Node con TypeScript nativo).
FROM node:24-alpine AS build
# logos (il nucleo condiviso) si installa da GitHub: serve git
RUN apk add --no-cache git
WORKDIR /app
COPY package.json package-lock.json ./
COPY protocol/package.json protocol/
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY protocol protocol
COPY web web
ARG VITE_OIDC_ISSUER=""
ARG VITE_OIDC_CLIENT_ID=""
ENV VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
RUN npm run build -w web

FROM node:24-alpine
RUN apk add --no-cache git
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY protocol/package.json protocol/
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server -w protocol
COPY protocol protocol
COPY server server
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8787
CMD ["node", "server/src/main.ts"]
