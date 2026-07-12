FROM node:22-alpine AS base
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
