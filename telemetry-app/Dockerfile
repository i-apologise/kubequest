FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY otel.cjs server.js ./
ENV PORT=8080
ENV OTEL_SERVICE_NAME=telemetry-api
EXPOSE 8080
CMD ["npm", "start"]
