# forge image (backend/forge): ONE image, two services in backend/deploy/compose.yml
#   forge-worker  python -m forge.worker        agent loop (OpenRouter egress only), MuJoCo checks
#   forge-cad     python -m forge.cad_service   run_cad sandbox server, network_mode: none, sees only /sock
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
# forge-worker runs as uid 1002, group 1000 (= the api's `node` group): it shares the job volume with the api
# through the group (dirs 2770, files 0660), with a uid of its own. forge-cad runs its launcher as root without
# DAC override (compose) and drops every CAD child to nobody; it mounts only /sock, never /jobs.
RUN groupadd --gid 1000 forge \
 && useradd --uid 1002 --gid 1000 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin forge \
 && mkdir -p /jobs /sock && chown 1000:1000 /jobs && chmod 2770 /jobs && chown 0:1000 /sock && chmod 0750 /sock
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
VOLUME ["/jobs", "/sock"]
CMD ["python", "-m", "forge.worker"]
LABEL org.opencontainers.image.source="https://github.com/artigrib/prlanding" \
      org.opencontainers.image.description="printedrobotics.cz forge worker + CAD sandbox" \
      org.opencontainers.image.licenses="NOASSERTION"
