# ---------- Phoswatch ML service (FastAPI) ---------------------------------
# Multi-stage build:
#   builder   - compiles wheels (needs gcc, libpq, python-dev)
#   runtime   - slim image that runs uvicorn as an unprivileged user
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS builder

WORKDIR /build

# Build-time system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ python3-dev libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps into a dedicated prefix so they copy cleanly
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install --no-warn-script-location \
        -r requirements.txt


# ---------- runtime stage --------------------------------------------------
FROM python:3.11-slim

WORKDIR /app

# Runtime deps (libpq for psycopg2, curl for the healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq-dev curl \
    && rm -rf /var/lib/apt/lists/* && apt-get clean

# Non-root user
RUN addgroup --system --gid 1001 mluser && \
    adduser  --system --uid 1001 --gid 1001 mluser

# Copy the installed packages from the builder into the system site-packages
COPY --from=builder /install /usr/local

# Application code + model / log directories
COPY --chown=mluser:mluser app ./app
RUN mkdir -p /app/models /app/logs && chown -R mluser:mluser /app

USER mluser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Single worker by default — multiple workers each load their own model,
# which doubles memory for the MLP/XGBoost. Tune in docker-compose if you
# have the RAM.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
