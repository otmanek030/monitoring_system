# ML Service Dockerfile - Python with FastAPI
FROM python:3.11-slim AS builder

WORKDIR /app

# Install system dependencies for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    python3-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --user --no-warn-script-location \
    -r requirements.txt

# Production stage
FROM python:3.11-slim

WORKDIR /app

# Install runtime system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user
RUN addgroup --system --gid 1001 python && \
    adduser --system --uid 1001 --gid 1001 python

# Copy dependencies from builder
COPY --from=builder --chown=python:python /root/.local /root/.local

# Copy application code
COPY --chown=python:python app ./app

# Create necessary directories
RUN mkdir -p /app/models /app/logs && \
    chown -R python:python /app/models /app/logs

# Make sure scripts in .local are usable
ENV PATH=/root/.local/bin:$PATH

# Switch to non-root user
USER python

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Run with uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]