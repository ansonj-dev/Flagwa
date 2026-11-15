FROM node:24-alpine AS build
WORKDIR /app/frontend
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_FLAGWA_API_BASE_URL=/backend
ENV VITE_FLAGWA_API_BASE_URL=$VITE_FLAGWA_API_BASE_URL
RUN npm run build

FROM node:24-alpine
WORKDIR /app/frontend
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/frontend/dist ./dist
COPY server ./server
USER node
EXPOSE 5173
CMD ["node", "server/index.ts"]