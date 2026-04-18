# Backend Dockerfile - Node.js with Express (Fixed)
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (using npm install instead of ci)
RUN npm install --production && npm cache clean --force

# Copy application code
COPY src ./src

# Create logs directory
RUN mkdir -p /app/logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Start application
CMD ["node", "src/server.js"]