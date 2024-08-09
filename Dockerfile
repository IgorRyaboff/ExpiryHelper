FROM node:20-alpine
COPY . /app
WORKDIR /app
RUN npm ci --omit=dev
CMD ["node", "app"]