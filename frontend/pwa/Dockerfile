FROM node:22-alpine

WORKDIR /app

COPY public ./public
COPY src ./src

# Simple static server for the PWA
RUN npm install -g serve

EXPOSE 4173

CMD ["serve", "public", "-l", "4173"]

