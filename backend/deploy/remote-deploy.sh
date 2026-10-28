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
    body=$(dc exec -T caddy wget -q -T 3 -O - http://127.0.0.1:18181/health 2>&1 || true)
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
      body=$(dc exec -T caddy wget -q -T 3 -O - http://127.0.0.1:18180/healthz 2>/dev/null || true)
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

proxies_80_443() { # PIDs of docker-proxy processes listening on host port 80 or 443
  local pid args
  for pid in $(pgrep -x docker-proxy || true); do
    args=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$args" in *"-host-port 80 "*|*"-host-port 443 "*) echo "$pid";; esac
  done
}

fix_stale_ports() {
  # Earlier failed starts of our Caddy left docker-proxy processes holding host ports 80/443
  # while no container publishes them (Docker 29 then refuses the port as "already allocated").
  # Only when NO running container of any project binds host port 80/443 are such proxies
  # leftovers that serve nobody; then stop them. Other containers are never touched.
  local n mapped
  n=$(proxies_80_443 | wc -l)
  [ "$n" -gt 0 ] || return 0
  mapped=$(docker ps -q | xargs -r docker inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostPort}} {{end}}{{end}}' 2>/dev/null | grep -cwE '80|443' || true)
  if [ "$mapped" -gt 0 ]; then
    warn "a running container publishes host port 80/443; leaving it alone"
    return 0
  fi
  warn "found $n leftover port-80/443 proxy process(es) without any container; stopping them"
  dc rm -sf caddy || true
  for pid in $(proxies_80_443); do kill "$pid" || true; done
  sleep 2
  say "leftover port-80/443 proxies after cleanup: $(proxies_80_443 | wc -l)"
}

bring_up() {
  build_env
  fixports
  fix_stale_ports
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
  dc exec -T caddy caddy reload --address 127.0.0.1:12019 --config /etc/caddy/Caddyfile --adapter caddyfile
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

diagnose() ( set +eu +o pipefail
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
  local port procs ours others ourips pid args cip
  ourips=" $(for id in $(dc ps --all -q 2>/dev/null); do docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$id" 2>/dev/null; done) "
  for port in 80 443; do
    procs=$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'users:(("[^"]*"' | sed 's/users:(("//' | sort | uniq -c | awk '{print $2"x"$1}' | tr '\n' ' ')
    ours=0; others=0
    for pid in $(pgrep -x docker-proxy || true); do
      args=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
      case "$args" in *"-host-port $port "*) ;; *) continue;; esac
      cip=$(printf '%s' "$args" | sed -n 's/.*-container-ip \([^ ]*\).*/\1/p')
      case "$ourips" in *" $cip "*) ours=$((ours + 1));; *) others=$((others + 1));; esac
    done
    say "diag tcp :$port listeners by process: ${procs:-none}; docker-proxy for :$port -> our containers: $ours, to other/unknown IPs: $others"
  done
  say "diag containers with host port 80 in their mapping (any project): $(docker ps --format '{{.Ports}}' | grep -cE '(0\.0\.0\.0|\[?::\]?):80->' || true), of them ours: $(dc ps --format '{{.Ports}}' 2>/dev/null | grep -cE ':80->' || true)"
  # Who do the 80/443 docker-proxies forward to? Categories only, never names or addresses.
  local c info
  for pid in $(pgrep -x docker-proxy || true); do
    args=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$args" in *"-host-port 80 "*|*"-host-port 443 "*) ;; *) continue;; esac
    cip=$(printf '%s' "$args" | sed -n 's/.*-container-ip \([^ ]*\).*/\1/p')
    info=""
    for c in $(docker ps -aq); do
      if docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$c" | grep -qw -- "$cip"; then
        info="$info [$(docker inspect -f '{{if eq (index .Config.Labels "com.docker.compose.project") "printedrobotics"}}ours{{else}}other{{end}} state={{.State.Status}} restarts={{.RestartCount}} hostports={{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostPort}},{{end}}{{end}}' "$c" | sed -E 's/hostports=(.*)/hp,\1/' | awk '{h=$NF; w=(h ~ /(^|,)(80|443),/) ? "maps-host-80/443=yes" : "maps-host-80/443=no"; $NF=w; print}')]"
      fi
    done
    say "diag proxy host-port $(printf '%s' "$args" | sed -n 's/.*-host-port \([0-9]*\).*/\1/p') proto $(printf '%s' "$args" | sed -n 's/.*-proto \([a-z]*\).*/\1/p') -> ${info:- no container with that IP}"
  done
  say "diag live-restore: $(docker info -f '{{.LiveRestoreEnabled}}' 2>/dev/null); swarm: $(docker info -f '{{.Swarm.LocalNodeState}}' 2>/dev/null)"
  say "diag docker: $(docker version -f '{{.Server.Version}}' 2>/dev/null), compose: $(docker compose version --short 2>/dev/null)"
)

porttest() ( set +eu +o pipefail
  # Throw-away containers (name prefix printedrobotics-porttest) to see which port bindings work.
  local n=0 spec net st
  for spec in "web 127.0.0.1:18081:80" "default 127.0.0.1:18082:80" "default 0.0.0.0:80:80" "web 0.0.0.0:80:80"; do
    n=$((n + 1)); set -- $spec; net=$1
    docker rm -f "printedrobotics-porttest$n" >/dev/null 2>&1
    if [ "$net" = web ]; then
      docker run -d --name "printedrobotics-porttest$n" --network printedrobotics_web -p "$2" caddy:2-alpine caddy respond --listen :80 ok
    else
      docker run -d --name "printedrobotics-porttest$n" -p "$2" caddy:2-alpine caddy respond --listen :80 ok
    fi
    sleep 2
    st=$(docker inspect -f '{{.State.Status}}|{{.State.Error}}' "printedrobotics-porttest$n" 2>&1)
    say "porttest $n net=$net bind=$(printf '%s' "$2" | sed -E 's/^[0-9.]+:/<ip>:/') -> $(sanitize "$st")"
    docker rm -f "printedrobotics-porttest$n" >/dev/null 2>&1
  done
)

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
  local total ours net name
  total=$(stale_endpoints | grep -c . )
  ours=$(stale_endpoints | awk '$2 ~ /^printedrobotics-/' | grep -c .)
  say "stale endpoints: total $total, ours $ours"
  stale_endpoints | awk '$2 ~ /^printedrobotics-/' | while read -r net name; do
    docker network disconnect -f "$net" "$name" && say "removed our stale endpoint ${name}" || warn "could not remove our stale endpoint ${name}"
  done
  say "after cleanup: stale endpoints total $(stale_endpoints | grep -c .), docker-proxy for :80 $(pgrep -a docker-proxy | grep -c -- '-host-port 80 ')"
)

tls_state() ( set +eu +o pipefail
  # Per-host ACME state as fixed strings: cert present + last error category from Caddy's log.
  local h cert logs cat fw cid
  cid=$(dc ps -q caddy 2>/dev/null | head -1)
  lg() { docker logs "$cid" 2>&1; }
  cnt() { lg | awk -v k="$1" 'index(tolower($0),tolower(k)){n++} END{print n+0}'; }
  say "tls caddy container: $([ -n "$cid" ] && echo found || echo missing); log driver: $(docker inspect -f '{{.HostConfig.LogConfig.Type}}' "$cid" 2>/dev/null); started: $(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null | cut -c1-16)"
  for h in api mcp relay; do
    cert=no
    dc exec -T caddy sh -c "ls /data/caddy/certificates/*/$h.printedrobotics.cz/$h.printedrobotics.cz.crt" >/dev/null 2>&1 && cert=yes
    [ -f "$ROOT/sites-enabled/$h.caddy" ] && en=yes || en=no
    cat=none
    l=$(lg | awk -v h="$h.printedrobotics.cz" 'index($0,h) && (index(tolower($0),"error")||index(tolower($0),"fail")||index($0,"rateLimited")||index($0,"unauthorized")) {x=$0} END{print x}')
    if [ -n "$l" ]; then
      case "$l" in
        *rateLimited*|*"rate limit"*|*429*) cat="rate-limited";;
        *"Timeout during connect"*|*"i/o timeout"*|*"timed out"*) cat="http-01 challenge: connection timeout";;
        *"Connection refused"*|*"connection refused"*) cat="http-01 challenge: connection refused";;
        *unauthorized*|*"Invalid response"*|*"404"*) cat="http-01 challenge: unauthorized/invalid response";;
        *"no such host"*|*NXDOMAIN*|*"DNS problem"*) cat="DNS problem";;
        *) cat="other error";;
      esac
    fi
    say "tls $h: site enabled: $en; cert present: $cert; last acme error: $cat"
  done
  say "tls: acme dns-01 not used; http-01 only"
  say "tls log counts: lines $(lg | wc -l), bytes $(lg | wc -c), obtaining $(cnt obtain), obtained $(cnt 'certificate obtained'), errors $(cnt '"level":"error"'), cert dirs $(dc exec -T caddy sh -c 'ls -d /data/caddy/certificates/*/* 2>/dev/null | wc -l')"
  say "tls storage: acme dir entries $(dc exec -T caddy sh -c 'ls /data/caddy/acme/*/ 2>/dev/null | wc -l'), data dirs $(dc exec -T caddy sh -c 'ls /data/caddy 2>/dev/null | tr "\n" " "'), writable $(dc exec -T caddy sh -c 'touch /data/caddy/.w && rm /data/caddy/.w && echo yes || echo no' 2>/dev/null)"
  local cfg
  cfg=$(dc exec -T caddy wget -q -T 3 -O - http://127.0.0.1:12019/config/apps/tls 2>&1)
  say "tls admin config: automation $(printf '%s' "$cfg" | grep -ac '"automation"'), issuers acme $(printf '%s' "$cfg" | grep -ac '"module":"acme"'), subjects $(printf '%s' "$cfg" | grep -o 'printedrobotics.cz' | wc -l), size $(printf '%s' "$cfg" | wc -c)"
  local hc
  hc=$(dc exec -T caddy wget -q -T 3 -O - http://127.0.0.1:12019/config/apps/http 2>&1)
  say "tls admin http config: size $(printf '%s' "$hc" | wc -c), hosts $(printf '%s' "$hc" | grep -o '[a-z]*\.printedrobotics\.cz' | sort -u | wc -l), automatic_https disabled $(printf '%s' "$hc" | grep -ac '"automatic_https":{"disable"'); tls config is $(case "$cfg" in *error*) echo error-response;; null*|"") echo empty;; *) echo present;; esac)"
  say "tls docker log bytes: $(docker logs "$cid" 2>&1 | wc -c); since 1h lines: $(docker logs --since 1h "$cid" 2>&1 | wc -l)"
  local k n
  for k in info warn error fatal caddyfile invalid listen bind permission address admin autosave started shutdown signal stopped reload config tls acme cert obtain redirect http2 http3 quic buffer user warning 'not found' 'no such' 'read-only' deprecated adapt overwritten; do
    n=$(cnt "$k")
    [ "$n" -gt 0 ] && say "tls log word [$k]: $n"
  done
  local ec
  for k in serverinternal 'error:internal' malformed badnonce rejectedidentifier incorrect secondary validation 'could not' 'http 500' 'http 400' 'http 403' 'http 429' 'http 503' 'status 500' 'maintenance' 'aaaa' ipv6 'ipv4' 'firewall' 'unexpected' 'bad' 'eof' 'reset' 'tls: ' 'handshake' 'unavailable' 'overloaded' 'try again' 'later' ratelimited 'rate limit' 429 'too many' timeout refused unauthorized 'invalid response' dns 'no valid' caa forbidden connection deadline retry policy account registration email zerossl letsencrypt 'rejected' 'urn:ietf' 'challenge' 'authorization' 'http-01' 'tls-alpn' 'dial' 'lookup' 'x509' 'storage' 'lock' 'permission' 'read-only file' 'directory' 'no such file' 'unable' 'cannot' 'invalid' 'order' 'finalize' 'server error' 'internal'; do
    ec=$(lg | awk -v k="$k" 'tolower($0) ~ /error/ && index(tolower($0),tolower(k)){n++} END{print n+0}')
    [ "$ec" -gt 0 ] && say "tls error-line word [$k]: $ec"
  done
  say "tls admin raw response: starts with brace $(printf '%s' "$hc" | head -c1 | grep -c '{'), contains html $(printf '%s' "$hc" | grep -aci '<html'), contains 'error' $(printf '%s' "$hc" | grep -aci error), contains 'wget' $(printf '%s' "$hc" | grep -aci wget)"
  say "tls shape: lines with json msg field $(cnt '"msg"'), with level $(cnt level), with tab $(lg | awk '/	/{n++} END{print n+0}')"
  say "tls admin http: reverse_proxy $(printf '%s' "$hc" | grep -ao 'reverse_proxy' | wc -l), host matchers $(printf '%s' "$hc" | grep -ao '"host"' | wc -l), listen entries $(printf '%s' "$hc" | grep -ao '"listen"' | wc -l)"
  for k in 'rateLimited' 'Timeout during connect' 'Connection refused' 'unauthorized' 'Invalid response' 'no valid A records' 'DNS problem' 'CAA' 'context deadline' 'permission denied' 'read-only'; do
    n=$(cnt "$k")
    [ "$n" -gt 0 ] && say "tls log category '$k': $n line(s)"
  done
  say "tls: caddy host-network listeners :80 $(ss -ltnH 'sport = :80' | wc -l), :443 $(ss -ltnH 'sport = :443' | wc -l)"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    u=$(ufw status 2>/dev/null)
    a80=no; a443=no
    printf '%s\n' "$u" | grep -E '^(80|80/tcp|Nginx|Apache|WWW)\b' | grep -q ALLOW && a80=yes
    printf '%s\n' "$u" | grep -E '^(443|443/tcp|WWW Secure|Nginx HTTPS)\b' | grep -q ALLOW && a443=yes
    fw="ufw active, 80 allowed $a80, 443 allowed $a443"
  elif command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | grep -qE 'hook input.*policy drop'; then
    fw="nft input policy drop present (ports not evaluated)"
  elif command -v iptables >/dev/null 2>&1 && iptables -S INPUT 2>/dev/null | grep -q '^-P INPUT DROP'; then
    fw="iptables INPUT policy drop"
  else
    fw="inactive (no ufw, no drop-policy nft/iptables input)"
  fi
  say "tls firewall: $fw"
)

case "$ACTION" in
  tlsrestart)
    [ -f "$ROOT/release.env" ] || die "no release deployed yet"
    build_env
    dc restart caddy && say "restarted our caddy container" || warn "caddy restart failed"
    sleep 90
    tls_state
    exit 0
    ;;
  tls)
    [ -f "$ROOT/release.env" ] || die "no release deployed yet"
    build_env
    tls_state
    exit 0
    ;;
  fixports)
    fixports
    porttest
    exit 0
    ;;
  porttest)
    porttest
    exit 0
    ;;
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
