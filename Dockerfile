FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js app.js index.html styles.css ./
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
