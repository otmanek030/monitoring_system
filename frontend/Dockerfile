# Frontend Dockerfile - React with multi-stage build (Fixed)
# Stage 1: Build the React application
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (using npm install instead of ci)
RUN npm install --no-audit --no-fund && npm cache clean --force

# Copy source code
COPY . .

# Disable ESLint during build (plugin may not be installed in clean Docker image)
ENV DISABLE_ESLINT_PLUGIN=true
ENV CI=false

# Build the application
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Remove default nginx website
RUN rm -rf /usr/share/nginx/html/*

# Copy built application from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Create health check endpoint
RUN echo '{"status":"healthy"}' > /usr/share/nginx/html/health.json

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/health.json || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]