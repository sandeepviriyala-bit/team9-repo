# Single image: build the React frontend, then serve it + the /api backend
# from the Express server (server/index.ts) via tsx. Suited to Cloud Run.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# npm install (not ci) so platform-correct native binaries (@tailwindcss/oxide
# for musl/alpine) are resolved; the committed lockfile was generated elsewhere.
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# --include=dev so tsx/esbuild (used to run the TS server) is present; npm install
# (not ci) so esbuild's musl native binary is resolved on alpine.
RUN npm install --include=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY tsconfig.json ./
EXPOSE 8080
CMD ["npm", "run", "start"]
