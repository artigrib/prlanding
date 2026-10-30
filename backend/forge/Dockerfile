# forge image (backend/forge): ONE image, two services in backend/deploy/compose.yml
#   forge-worker  python -m forge.worker        agent loop (OpenRouter egress only), MuJoCo checks
#   forge-cad     python -m forge.cad_service   run_cad sandbox server, network_mode: none
# Build context = repo root (the image needs sim/so101/model and data/components); see Dockerfile.dockerignore.
#   docker build -f backend/forge/Dockerfile -t forge .
FROM python:3.13-slim
ARG APP_VERSION=dev
# libGL/libX11 for OCP (build123d) and MuJoCo's shared libraries; nothing else from apt.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libexpat1 \
 && rm -rf /var/lib/apt/lists/*
COPY backend/forge/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt
# Non-root, fixed uid 1000 = the api image's `node` user, so the shared /jobs volume is writable by both.
RUN useradd --uid 1000 --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin forge \
 && mkdir -p /jobs && chown forge:forge /jobs
WORKDIR /app
COPY sim/so101/model /app/sim/so101/model
COPY data/components /app/data/components
COPY backend/forge/forge /app/backend/forge/forge
COPY backend/forge/designs /app/backend/forge/designs
COPY backend/forge/templates /app/backend/forge/templates
COPY backend/forge/eval /app/backend/forge/eval
ENV APP_VERSION=$APP_VERSION \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FORGE_JOBS_DIR=/jobs \
    HOME=/tmp \
    MPLCONFIGDIR=/tmp \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1
# Byte-compile at build time: the root filesystem is read-only at run time.
RUN python -m compileall -q /app/backend/forge/forge /app/backend/forge/eval
WORKDIR /app/backend/forge
USER forge
VOLUME ["/jobs"]
CMD ["python", "-m", "forge.worker"]
LABEL org.opencontainers.image.source="https://github.com/artigrib/prlanding" \
      org.opencontainers.image.description="printedrobotics.cz forge worker + CAD sandbox" \
      org.opencontainers.image.licenses="NOASSERTION"
