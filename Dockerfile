FROM node:22-slim

WORKDIR /app

COPY dist ./dist
COPY node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/main.js"]
