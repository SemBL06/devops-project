FROM node:24-alpine

ENV NODE_ENV=production
ENV PORT=5173

WORKDIR /app

# Copy only required runtime files.
COPY server.js ./server.js
COPY public ./public
COPY README.md ./README.md

# Run as an unprivileged user.
USER node

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:5173/api/health || exit 1

CMD ["node", "server.js"]
