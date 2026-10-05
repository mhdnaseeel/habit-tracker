FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM build AS migrate
CMD ["npm", "run", "db:migrate"]

FROM build AS runtime-deps
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=development
WORKDIR /app
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/apps/api/src/main.js"]

FROM nginx:stable-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
