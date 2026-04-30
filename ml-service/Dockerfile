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

# Install Python deps into a dedicated prefix so they copy cleanly.
# --retries + --timeout make pip resilient on slow / flaky connections
# (xgboost/scipy/pandas wheels are ~50MB each and frequently time out).
#
# Strategy: pin pip, install heavy numeric wheels FIRST (so a network
# blip on numpy/scipy/xgboost doesn't restart the whole resolver), then
# install the rest. This shaves rebuild time significantly when only
# the lighter dependencies change.
COPY requirements.txt .
ENV PIP_DEFAULT_TIMEOUT=180 \
    PIP_RETRIES=15 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
# Install in a single pass with a current pip + build tools.
# Build deps (gcc/g++/python3-dev) are present from the apt-get above so
# any package without a wheel for this platform can still compile.
RUN pip install --upgrade "pip>=24.0" "setuptools>=68" "wheel" && \
    pip install --prefix=/install --no-warn-script-location \
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
