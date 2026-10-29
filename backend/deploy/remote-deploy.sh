#!/usr/bin/env bash
# Runs ON THE SERVER (piped by deploy-backend.yml / rollback-backend.yml over SSH).
# Touches only the compose project "printedrobotics" and images named ghcr.io/artigrib/prlanding-*.
#
# Usage: ACTION=deploy|rollback|status|fixports [API_IMAGE=... BRIDGE_IMAGE=... APP_VERSION=...
#        GHCR_USER=...] bash remote-deploy.sh
#   deploy reads stdin: line 1 = GHCR token (may be empty), then optional analytics settings as
#   NAME=<base64 value> lines (names in ANALYTICS_VARS; empty value = that sink off). They are written to
#   $ROOT/analytics.env (0600) and replace the previous file, so removing a GitHub secret switches a sink off.
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

ANALYTICS_VARS="CLICKHOUSE_URL CLICKHOUSE_USER CLICKHOUSE_PASSWORD AMPLITUDE_API_KEY COUNTRY_HEADER"

build_env() {
  # Combine generated secrets, analytics settings (from GitHub secrets) and the current release into the
  # file compose reads.
  touch "$ROOT/analytics.env"; chmod 600 "$ROOT/analytics.env"
  cat "$ROOT/secrets.env" "$ROOT/analytics.env" "$ROOT/release.env" > "$ROOT/.compose.env.tmp"
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
}

hget() { # hget PORT PATH -> raw HTTP/1.0 response from a 127.0.0.1-published port (works without our Caddy)
  timeout 5 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1; printf 'GET $2 HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3; cat <&3" 2>/dev/null || true
}

check_health() { # check_health EXPECTED_VERSION BRIDGE_ENABLED
  local v="$1" bridge="$2" body i
  for i in $(seq 1 20); do
    body=$(hget 18181 /health)
    case "$body" in *'"ok":true'*) break;; esac
    sleep 3
  done
  case "$body" in
    *"\"version\":\"$v\""*) say "internal check: api /health ok (version ${v:0:12})";;
    *'"ok":true'*) warn "internal check: api healthy but reports another version"; return 1;;
    *) warn "internal check: api /health not reachable on its loopback port"; return 1;;
  esac
  if [ "$bridge" = 1 ]; then
    for i in $(seq 1 20); do
      body=$(hget 18180 /healthz)
      case "$body" in *'"ok":true'*) break;; esac
      sleep 3
    done
    case "$body" in
      *'"ok":true'*) say "internal check: bridge /healthz ok";;
      *) warn "internal check: bridge /healthz not reachable on its loopback port"; return 1;;
    esac
  fi
  return 0
}



ensure_network() {
  # printedrobotics_web is declared `external` in compose.yml: compose never creates, removes or
  # recreates it, so containers of other projects attached to it (an external edge proxy) stay
  # attached across our deploys and rollbacks. Created here once if missing.
  if ! docker network inspect printedrobotics_web >/dev/null 2>&1; then
    docker network create --driver bridge --label org.printedrobotics.owner=printedrobotics printedrobotics_web >/dev/null \
      && say "network printedrobotics_web created" || die "could not create network printedrobotics_web"
  fi
}

guard_no_public_ports() {
  # Our stack must never take host ports 80/443 (another project's edge proxy owns them) and never
  # use host networking. Refuse to run compose with a file that would.
  if grep -qE '^[[:space:]]*network_mode:[[:space:]]*"?host|(^|[^0-9])(80|443):[0-9]+|^[[:space:]]{2}caddy:' "$ROOT/compose.yml"; then
    die "compose.yml would bind host 80/443, use host networking or run caddy; refusing"
  fi
}


bring_up() {
  build_env
  ensure_network
  guard_no_public_ports
  fixports
  local profiles
  profiles=$(release_var "$ROOT/release.env" COMPOSE_PROFILES | tr ',' '\n' | grep -x bridge | paste -sd, -)
  local err
  if ! err=$(COMPOSE_PROFILES="$profiles" dc up -d --remove-orphans --wait --wait-timeout 150 2>&1); then
    warn "compose up failed ($(classify_err "$err"))"
    return 1
  fi
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
  say "disk guard ok"
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
  cp "$INCOMING/compose.yml" "$ROOT/compose.yml"
  chmod 644 "$ROOT/compose.yml"
  # Leftovers of the removed Caddy setup.
  rm -rf "$ROOT/Caddyfile" "$ROOT/sites" "$ROOT/sites-enabled" "$ROOT/prev-config"
  say "deploy files installed"
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

read_stdin() {
  # Line 1: GHCR token. Then NAME=<base64> analytics lines. Values are never printed.
  GHCR_TOKEN=""
  IFS= read -r GHCR_TOKEN || true
  local line name b64 val out="" on=""
  while IFS= read -r line; do
    name=${line%%=*}; b64=${line#*=}
    case " $ANALYTICS_VARS " in *" $name "*) ;; *) continue;; esac
    val=$(printf '%s' "$b64" | base64 -d 2>/dev/null) || { warn "analytics setting $name: not valid base64, ignored"; continue; }
    # compose .env single-quoted literal: printable ASCII without space, quotes or backslash only
    if [ -n "$(printf '%s' "$val" | LC_ALL=C tr -d '!#-&(-[]-~')" ]; then
      warn "analytics setting $name: unsupported characters, ignored"; continue
    fi
    out="$out$name='$val'"$'\n'
    [ -n "$val" ] && on="$on $name"
  done
  printf '%s' "$out" > "$ROOT/analytics.env.tmp"
  chmod 600 "$ROOT/analytics.env.tmp"
  mv -f "$ROOT/analytics.env.tmp" "$ROOT/analytics.env"
  local sinks="ndjson"
  case "$on" in *CLICKHOUSE_URL*) case "$on" in *CLICKHOUSE_USER*) case "$on" in *CLICKHOUSE_PASSWORD*) sinks="$sinks, clickhouse";; esac;; esac;; esac
  case "$on" in *AMPLITUDE_API_KEY*) sinks="$sinks, amplitude";; esac
  say "analytics sinks: $sinks"
}

pull_images() {
  local token="${GHCR_TOKEN:-}" tmp ref
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
  say "images pulled"
}

rollback() {
  if [ ! -f "$ROOT/release.prev.env" ]; then
    warn "no previous release to roll back to; stopping the failed release"
    # stop, never `down`: the external network and anything attached to it must survive.
    dc stop || true
    return 1
  fi
  cp "$ROOT/release.env" "$ROOT/release.failed.env" 2>/dev/null || true
  cp "$ROOT/release.prev.env" "$ROOT/release.env"
  if bring_up && check_health "$(release_var "$ROOT/release.env" APP_VERSION)" \
       "$([ -n "$(release_var "$ROOT/release.env" BRIDGE_IMAGE)" ] && echo 1 || echo 0)"; then
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



stale_endpoints() ( set +eu +o pipefail
  # Endpoints in any network whose container no longer exists. Prints "<network-id> <endpoint-name>".
  local net
  local ids=" $(docker ps -aq --no-trunc | tr '\n' ' ') "
  for net in $(docker network ls -q --no-trunc); do
    docker network inspect -f '{{range $id, $c := .Containers}}{{$id}} {{$c.Name}}{{println}}{{end}}' "$net" 2>/dev/null \
      | while read -r cid name; do
          [ -n "$cid" ] || continue
          case "$ids" in *" $cid "*) ;; *) echo "$net $name";; esac
        done
  done
)

fixports() ( set +eu +o pipefail
  # Remove only our own stale endpoints (names printedrobotics-*); nothing is printed about others.
  local net name n=0
  while read -r net name; do
    docker network disconnect -f "$net" "$name" && n=$((n + 1))
  done < <(stale_endpoints | awk '$2 ~ /^printedrobotics-/')
  [ "$n" = 0 ] || say "removed $n stale endpoint(s) of ours"
)


case "$ACTION" in
  fixports)
    fixports
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
read_stdin

{
  echo "APP_VERSION=$APP_VERSION"
  echo "API_IMAGE=$API_IMAGE"
  echo "BRIDGE_IMAGE=${BRIDGE_IMAGE:-}"
  echo "COMPOSE_PROFILES=$([ -n "${BRIDGE_IMAGE:-}" ] && echo bridge || true)"
} > "$ROOT/release.next.env"

pull_images

# Keep the current release for a rollback (images only; compose.yml is not rolled back).
[ -f "$ROOT/release.env" ] && cp "$ROOT/release.env" "$ROOT/release.prev.env"

install_files
mv -f "$ROOT/release.next.env" "$ROOT/release.env"

bridge_on=0; [ -n "${BRIDGE_IMAGE:-}" ] && bridge_on=1
if bring_up && check_health "$APP_VERSION" "$bridge_on"; then
  report_services
  say "deploy ok: release ${APP_VERSION:0:12} is healthy"
  prune_old_images
  exit 0
fi

warn "new release failed its health checks; rolling back"
report_services
rollback || true
die "deploy failed (release ${APP_VERSION:0:12})"
