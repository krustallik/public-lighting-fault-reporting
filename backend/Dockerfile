FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY scripts/copy-service-area-assets.mjs ./scripts/copy-service-area-assets.mjs
COPY scripts/copy-db-assets.mjs ./scripts/copy-db-assets.mjs
COPY scripts/smoke-compiled-service-area.mjs ./scripts/smoke-compiled-service-area.mjs

RUN npm run build

EXPOSE 5000

CMD ["npm", "start"]
