FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY . .
RUN mkdir -p uploads data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
