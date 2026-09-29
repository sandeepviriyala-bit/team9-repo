# Single image: build the React frontend, then serve it + the /api backend
# from the Express server (server/index.ts) via tsx. Suited to Cloud Run.
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# --include=dev so tsx (used to run the TS server) is present despite NODE_ENV=production.
RUN npm ci --include=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY tsconfig.json ./
EXPOSE 8080
CMD ["npm", "run", "start"]
