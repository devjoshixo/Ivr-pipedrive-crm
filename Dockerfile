# IVRSolutions Pipedrive integration backend.
FROM node:20-alpine

WORKDIR /app

# Install production dependencies first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# App source.
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Basic container healthcheck against the health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/src/server.js"]
