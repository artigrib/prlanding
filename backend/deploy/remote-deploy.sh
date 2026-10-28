#!/usr/bin/env bash
# Runs ON THE SERVER (piped by deploy-backend.yml / rollback-backend.yml over SSH).
# Touches only the compose project "printedrobotics" and images named ghcr.io/artigrib/prlanding-*.
#
# Usage: ACTION=deploy|rollback|status [API_IMAGE=... BRIDGE_IMAGE=... APP_VERSION=... SITES="api mcp"
#        GHCR_USER=...] bash remote-deploy.sh   (GHCR token, if any, on stdin)
#
# Output contract: the only lines written to stdout are "STATUS ..." / "WARN ..." / "ERROR ..."
# with fixed, low-sensitivity text; the workflow turns them into annotations. Actions logs are
# public, so nothing else (paths, IPs, other containers, secrets) may be printed.
set -euo pipefail
umask 077
exec 3>&1 >/dev/null 2>&1

ROOT=/opt/printedrobotics
INCOMING="$ROOT/incoming"
PROJECT=printedrobotics
IMAGE_PREFIX=ghcr.io/artigrib/prlanding-
MIN_FREE_GB=3
ACTION=${ACTION:-deploy}

say()  { echo "STATUS $*" >&3; }
warn() { echo "WARN $*" >&3; }
die()  { echo "ERROR $*" >&3; exit 1; }

dc() { docker compose -p "$PROJECT" --project-directory "$ROOT" -f "$ROOT/compose.yml" --env-file "$ROOT/.compose.env" "$@" </dev/null; }

build_env() {
  # Combine generated secrets and the current release into the file compose reads.
  cat "$ROOT/secrets.env" "$ROOT/release.env" > "$ROOT/.compose.env.tmp"
  chmod 600 "$ROOT/.compose.env.tmp"
  mv -f "$ROOT/.compose.env.tmp" "$ROOT/.compose.env"
}

release_var() { # release_var FILE NAME
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1
}

report_services() {
  local line
  while IFS= read -r line; do
    [ -n "$line" ] && say "service $line"
  done < <(dc ps --all --format '{{.Service}}: {{.State}} {{.Health}}' 2>/dev/null || true)
  # For containers that are not running, show Docker's own start error (sanitized).
  local id st
  for id in $(dc ps --all -q 2>/dev/null || true); do
    st=$(docker inspect -f '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}' "$id" 2>/dev/null || true)
    case "$st" in running*) continue;; esac
    warn "container $(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id" 2>/dev/null): $(sanitize "$st")"
  done
}

check_health() { # check_health EXPECTED_VERSION BRIDGE_ENABLED
  local v="$1" bridge="$2" body i
  for i in $(seq 1 20); do
    body=$(dc exec -T caddy wget -q -T 3 -O - http://api:8081/health 2>&1 || true)
    case "$body" in *'"ok":true'*) break;; esac
    sleep 3
  done
  case "$body" in *'"ok":true'*) ;; *) warn "caddy -> api check output: $(sanitize "$body")";; esac
  case "$body" in
    *"\"version\":\"$v\""*) say "internal check: caddy -> api /health ok (version ${v:0:12})";;
    *'"ok":true'*) warn "internal check: api healthy but reports another version"; return 1;;
    *) warn "internal check: api /health not reachable from caddy"; return 1;;
  esac
  if [ "$bridge" = 1 ]; then
    for i in $(seq 1 20); do
      body=$(dc exec -T caddy wget -q -T 3 -O - http://bridge:8080/healthz 2>/dev/null || true)
      case "$body" in *'"ok":true'*) break;; esac
      sleep 3
    done
    case "$body" in
      *'"ok":true'*) say "internal check: caddy -> bridge /healthz ok";;
      *) warn "internal check: bridge /healthz not reachable from caddy"; return 1;;
    esac
  fi
  return 0
}

bring_up() {
  build_env
  # A Caddy container left half-started (not attached to our network) is removed first.
  local cid nets
  cid=$(dc ps --all -q caddy 2>/dev/null || true)
  if [ -n "$cid" ]; then
    nets=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$cid" 2>/dev/null || true)
    case "$nets" in *printedrobotics_web*) ;; *) warn "removing a caddy container that is not on our network"; dc rm -sf caddy || true;; esac
  fi
  local profiles
  profiles=$(release_var "$ROOT/release.env" COMPOSE_PROFILES)
  local err
  if ! err=$(COMPOSE_PROFILES="$profiles" dc up -d --remove-orphans --wait --wait-timeout 150 2>&1); then
    warn "compose up failed: $(sanitize "$(printf '%s\n' "$err" | grep -v '^ *$' | tail -3)")"
    local p=""
    ss -ltn 2>/dev/null | grep -q ':80 ' && p="$p 80/tcp"
    ss -ltn 2>/dev/null | grep -q ':443 ' && p="$p 443/tcp"
    ss -lun 2>/dev/null | grep -q ':443 ' && p="$p 443/udp"
    [ -z "$p" ] || warn "host ports currently listening:$p"
    return 1
  fi
}

sanitize() { # strip addresses, ids and paths from an error line before it reaches the public log
  printf '%s' "$1" | tr '\n' ' ' \
    | sed -E 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/<ip>/g; s/\[?[0-9a-fA-F:]{6,}\]?/<id>/g; s#(/[A-Za-z0-9._-]+){2,}#<path>#g' \
    | cut -c1-240
}

caddy_reload() {
  dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}

prune_old_images() {
  # Keep images referenced by the current and previous release; remove our other images only.
  local keep="" ref id f removed=0
  for f in "$ROOT/release.env" "$ROOT/release.prev.env"; do
    for ref in $(release_var "$f" API_IMAGE) $(release_var "$f" BRIDGE_IMAGE); do
      id=$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null || true)
      [ -n "$id" ] && keep="$keep $id"
    done
  done
  while read -r repo id; do
    case "$repo" in "$IMAGE_PREFIX"*) ;; *) continue;; esac
    case " $keep " in *" $id "*) continue;; esac
    docker image rm "$id" && removed=$((removed + 1)) || true
  done < <(docker image ls --no-trunc --format '{{.Repository}} {{.ID}}' | sort -u)
  say "pruned $removed old printedrobotics image(s)"
}

disk_guard() {
  local dir=/var/lib/docker free_kb
  [ -d "$dir" ] || dir=/
  free_kb=$(df -Pk "$dir" | awk 'NR==2{print $4}')
  if [ "${free_kb:-0}" -lt $((MIN_FREE_GB * 1024 * 1024)) ]; then
    die "disk guard: less than ${MIN_FREE_GB} GB free, aborting (nothing changed)"
  fi
  say "disk guard ok: $((free_kb / 1024 / 1024)) GB free"
}

ensure_secrets() {
  local f="$ROOT/secrets.env" created=0
  touch "$f"; chmod 600 "$f"
  if ! grep -q '^STATS_TOKEN=' "$f"; then echo "STATS_TOKEN=$(openssl rand -hex 32)" >> "$f"; created=1; fi
  if ! grep -q '^BRIDGE_HMAC_KEY=' "$f"; then echo "BRIDGE_HMAC_KEY=$(openssl rand -hex 32)" >> "$f"; created=1; fi
  [ "$created" = 1 ] && say "server secrets: generated" || say "server secrets: kept"
}

install_files() {
  [ -f "$INCOMING/compose.yml" ] || die "deploy files missing"
  install -d -m 750 "$ROOT/sites" "$ROOT/sites-enabled"
  # cp (not mv) keeps the inode, so Caddy's bind-mounted Caddyfile sees the new content.
  cp "$INCOMING/compose.yml" "$ROOT/compose.yml"
  cp "$INCOMING/Caddyfile" "$ROOT/Caddyfile"
  chmod 644 "$ROOT/Caddyfile" "$ROOT/compose.yml"
  rm -f "$ROOT"/sites/*.caddy
  cp "$INCOMING"/sites/*.caddy "$ROOT/sites/"
  # Enable only the sites the workflow verified (DNS points here).
  rm -f "$ROOT"/sites-enabled/*.caddy
  local s enabled=""
  for s in ${SITES:-}; do
    case "$s" in *[!a-z]*|"") continue;; esac
    if [ -f "$ROOT/sites/$s.caddy" ]; then
      cp "$ROOT/sites/$s.caddy" "$ROOT/sites-enabled/$s.caddy"
      enabled="$enabled $s"
    fi
  done
  chmod 644 "$ROOT"/sites/*.caddy "$ROOT"/sites-enabled/*.caddy 2>/dev/null || true
  chmod 755 "$ROOT/sites-enabled"
  say "https sites enabled:${enabled:- none}"
}

classify_err() { # map a docker error to a fixed, non-sensitive reason
  case "$1" in
    *unauthorized*|*denied*|*403*|*401*) echo "unauthorized/denied";;
    *"no such host"*|*"server misbehaving"*|*"lookup "*) echo "DNS lookup failed";;
    *timeout*|*"timed out"*|*"i/o timeout"*) echo "network timeout";;
    *x509*|*certificate*) echo "TLS certificate problem";;
    *"not found"*|*"manifest unknown"*) echo "image not found";;
    *"no space"*) echo "no space left";;
    *"Cannot connect to the Docker daemon"*) echo "docker daemon not reachable";;
    *"not a docker command"*|*"unknown flag"*) echo "docker CLI too old";;
    *) echo "other error";;
  esac
}

pull_images() {
  local token="" tmp ref
  IFS= read -r token || true
  tmp=$(mktemp -d)
  # Public packages pull anonymously; otherwise log in with the job's short-lived token
  # in a throw-away docker config (nothing is stored on the server).
  local logged_in=0
  for ref in "$API_IMAGE" ${BRIDGE_IMAGE:-}; do
    if DOCKER_CONFIG="$tmp" docker pull "$ref"; then continue; fi
    if [ "$logged_in" = 0 ] && [ -n "$token" ] && [ -n "${GHCR_USER:-}" ]; then
      if err=$(printf '%s' "$token" | DOCKER_CONFIG="$tmp" docker login ghcr.io -u "$GHCR_USER" --password-stdin 2>&1); then
        logged_in=1
      else
        warn "registry login failed ($(classify_err "$err"))"
      fi
    fi
    if ! err=$(DOCKER_CONFIG="$tmp" docker pull "$ref" 2>&1); then
      DOCKER_CONFIG="$tmp" docker logout ghcr.io || true; rm -rf "$tmp"
      die "image pull failed ($(classify_err "$err"))"
    fi
  done
  DOCKER_CONFIG="$tmp" docker logout ghcr.io || true
  rm -rf "$tmp"
  docker pull "$(release_var "$ROOT/release.next.env" CADDY_IMAGE)" || die "caddy image pull failed"
  say "images pulled"
}

rollback() {
  if [ ! -f "$ROOT/release.prev.env" ]; then
    warn "no previous release to roll back to; stopping the failed release"
    dc down --remove-orphans || true
    return 1
  fi
  cp "$ROOT/release.env" "$ROOT/release.failed.env" 2>/dev/null || true
  cp "$ROOT/release.prev.env" "$ROOT/release.env"
  if bring_up && check_health "$(release_var "$ROOT/release.env" APP_VERSION)" \
       "$([ -n "$(release_var "$ROOT/release.env" BRIDGE_IMAGE)" ] && echo 1 || echo 0)"; then
    caddy_reload || true
    say "rolled back to previous release ($(release_var "$ROOT/release.env" APP_VERSION | cut -c1-12))"
    return 0
  fi
  warn "rollback release is not healthy either"
  report_services
  return 1
}

# ---------------------------------------------------------------------------------------------
command -v docker >/dev/null || die "docker not installed"
docker compose version >/dev/null || die "docker compose plugin missing"
install -d -m 750 "$ROOT"
cd "$ROOT"

diagnose() {
  # Low-sensitivity facts only: counts, our own network names, our own DNS lookups.
  local id n
  for id in $(dc ps --all -q 2>/dev/null || true); do
    n=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}: networks={{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$id" 2>/dev/null || true)
    say "diag $n"
  done
  say "diag containers attached to our network: $(docker network inspect printedrobotics_web -f '{{len .Containers}}' 2>/dev/null || echo none)"
  say "diag other containers publishing 80: $(docker ps --filter publish=80 --format '{{.Label "com.docker.compose.project"}}' | grep -vc '^printedrobotics$' || true), 443: $(docker ps --filter publish=443 --format '{{.Label "com.docker.compose.project"}}' | grep -vc '^printedrobotics$' || true)"
  say "diag docker-proxy processes: $(pgrep -c docker-proxy || echo 0); listening tcp :80 sockets: $(ss -ltnH 'sport = :80' 2>/dev/null | wc -l)"
  say "diag caddy resolves api: $(sanitize "$(dc exec -T caddy nslookup api 127.0.0.11 2>&1 | grep -ciE 'address' || true) address line(s)")"
  say "diag docker: $(docker version -f '{{.Server.Version}}' 2>/dev/null), compose: $(docker compose version --short 2>/dev/null)"
}

case "$ACTION" in
  diag)
    [ -f "$ROOT/release.env" ] || die "no release deployed yet"
    build_env
    report_services
    diagnose
    exit 0
    ;;
  status)
    [ -f "$ROOT/release.env" ] || die "no release deployed yet"
    build_env
    say "current release: $(release_var "$ROOT/release.env" APP_VERSION | cut -c1-12)"
    report_services
    exit 0
    ;;
  rollback)
    [ -f "$ROOT/release.env" ] || die "no release deployed yet"
    ensure_secrets
    if rollback; then exit 0; else die "rollback failed"; fi
    ;;
  deploy) ;;
  *) die "unknown action";;
esac

[ -n "${API_IMAGE:-}" ] || die "API_IMAGE missing"
case "$API_IMAGE" in "$IMAGE_PREFIX"api@sha256:*) ;; *) die "unexpected api image reference";; esac
if [ -n "${BRIDGE_IMAGE:-}" ]; then
  case "$BRIDGE_IMAGE" in "$IMAGE_PREFIX"bridge@sha256:*) ;; *) die "unexpected bridge image reference";; esac
fi
case "${APP_VERSION:-}" in *[!0-9a-f]*|"") die "bad version";; esac

disk_guard
ensure_secrets

{
  echo "APP_VERSION=$APP_VERSION"
  echo "API_IMAGE=$API_IMAGE"
  echo "BRIDGE_IMAGE=${BRIDGE_IMAGE:-}"
  echo "CADDY_IMAGE=caddy:2-alpine"
  echo "COMPOSE_PROFILES=$([ -n "${BRIDGE_IMAGE:-}" ] && echo bridge || true)"
} > "$ROOT/release.next.env"

pull_images

# Snapshot the files that a rollback must restore together with the images.
if [ -f "$ROOT/release.env" ]; then
  cp "$ROOT/release.env" "$ROOT/release.prev.env"
  rm -rf "$ROOT/prev-config"; install -d -m 750 "$ROOT/prev-config"
  cp -a "$ROOT/compose.yml" "$ROOT/Caddyfile" "$ROOT/sites-enabled" "$ROOT/prev-config/" 2>/dev/null || true
fi

install_files
mv -f "$ROOT/release.next.env" "$ROOT/release.env"

bridge_on=0; [ -n "${BRIDGE_IMAGE:-}" ] && bridge_on=1
if bring_up && caddy_reload && check_health "$APP_VERSION" "$bridge_on"; then
  report_services
  say "deploy ok: release ${APP_VERSION:0:12} is healthy"
  prune_old_images
  exit 0
fi

warn "new release failed its health checks; rolling back"
report_services
diagnose
if [ -d "$ROOT/prev-config" ]; then
  cp "$ROOT/prev-config/compose.yml" "$ROOT/compose.yml" 2>/dev/null || true
  cp "$ROOT/prev-config/Caddyfile" "$ROOT/Caddyfile" 2>/dev/null || true
  rm -f "$ROOT"/sites-enabled/*.caddy
  cp "$ROOT"/prev-config/sites-enabled/*.caddy "$ROOT/sites-enabled/" 2>/dev/null || true
fi
rollback || true
die "deploy failed (release ${APP_VERSION:0:12})"
