# Awaken midnight agent for Maritime: zero dependencies, Node runs server.ts directly (type stripping).
FROM node:24-alpine
WORKDIR /app
COPY package.json server.ts ./
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server.ts"]
