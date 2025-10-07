#!/usr/bin/env bash
# Configure FreeRADIUS on Arch for local testing
# - bind auth socket to 127.0.0.1
# - add a client with shared secret
# - add a test user with Cleartext-Password and Class attribute
#
# Usage:
#   sudo ./radius-proxy/scripts/setup-freeradius-arch.sh
#
# Environment overrides:
#   RADIUS_TEST_USER (default: testuser)
#   RADIUS_TEST_PASS (default: testpass)
#   RADIUS_TEST_SECRET (default: testing123)
#   RADIUS_BIND_IP (default: 127.0.0.1)
#   RADIUS_PORT (default: 1812)

set -euo pipefail

USER="${RADIUS_TEST_USER:-testuser}"
PASS="${RADIUS_TEST_PASS:-testpass}"
SECRET="${RADIUS_TEST_SECRET:-testing123}"
BIND_IP="${RADIUS_BIND_IP:-127.0.0.1}"
PORT="${RADIUS_PORT:-1812}"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"

CONF_DIR="/etc/raddb"
if [ ! -d "$CONF_DIR" ]; then
  echo "Error: FreeRADIUS config dir $CONF_DIR not found"
  exit 1
fi

echo "Config dir: $CONF_DIR"
echo "User: $USER, Bind IP: $BIND_IP, Port: $PORT"

backup() {
  local f="$1"
  if [ -f "$f" ]; then
    cp -p "$f" "${f}.bak.${TIMESTAMP}"
    echo "Backed up $f -> ${f}.bak.${TIMESTAMP}"
  fi
}

SITE_CANDIDATES=("$CONF_DIR/sites-available/default" "$CONF_DIR/sites-enabled/default" "$CONF_DIR/sites-available/inner-tunnel")
FOUND_SITE=""
for s in "${SITE_CANDIDATES[@]}"; do
  if [ -f "$s" ]; then
    FOUND_SITE="$s"
    break
  fi
done

if [ -n "$FOUND_SITE" ]; then
  backup "$FOUND_SITE"
  TMP=$(mktemp)
  awk -v ip="$BIND_IP" '
  BEGIN { inblock=0; buf="" }
  {
    if ($0 ~ /^[[:space:]]*listen[[:space:]]*{[[:space:]]*$/) { inblock=1; buf=$0 "\n"; next }
    if (inblock) {
      buf = buf $0 "\n"
      if ($0 ~ /^[[:space:]]*}[[:space:]]*$/) {
        if (buf ~ /type[[:space:]]*=[[:space:]]*auth/) {
          if (buf !~ /ipaddr[[:space:]]*=/) {
            sub(/\}[[:space:]]*\n$/, "    ipaddr = " ip "\n}\n", buf)
          }
        }
        printf "%s", buf
        inblock=0; buf=""; next
      }
      next
    }
    print $0
  }' "$FOUND_SITE" > "$TMP" && mv "$TMP" "$FOUND_SITE"
  echo "Updated listen block in $FOUND_SITE"
else
  echo "No site file found to modify; skipping listen binding update"
fi

CLIENTS_FILE="$CONF_DIR/clients.conf"
backup "$CLIENTS_FILE"
cat >> "$CLIENTS_FILE" <<EOF

# Test client for local unit tests
client testsrv_${TIMESTAMP} {
    ipaddr = ${BIND_IP}
    secret = ${SECRET}
    shortname = testsrv_${TIMESTAMP}
    nastype = other
}
EOF
echo "Appended client to $CLIENTS_FILE"

USERS_FILE="$CONF_DIR/users"
backup "$USERS_FILE"
cat >> "$USERS_FILE" <<EOF

# Test user for unit tests
${USER} Cleartext-Password := "${PASS}"
    Reply-Message := "Test user for unit tests",
    Class := "test_group"
EOF
echo "Appended user to $USERS_FILE"

if [ "$PORT" != "1812" ] && [ -n "$FOUND_SITE" ]; then
  TMP=$(mktemp)
  awk -v port="$PORT" '
  BEGIN { inblock=0; buf="" }
  {
    if ($0 ~ /^[[:space:]]*listen[[:space:]]*{[[:space:]]*$/) { inblock=1; buf=$0 "\n"; next }
    if (inblock) {
      buf = buf $0 "\n"
      if ($0 ~ /^[[:space:]]*}[[:space:]]*$/) {
        if (buf ~ /type[[:space:]]*=[[:space:]]*auth/) {
          if (buf !~ /port[[:space:]]*=/) {
            sub(/\}[[:space:]]*\n$/, "    port = " port "\n}\n", buf)
          }
        }
        printf "%s", buf
        inblock=0; buf=""; next
      }
      next
    }
    print $0
  }' "$FOUND_SITE" > "$TMP" && mv "$TMP" "$FOUND_SITE"
  echo "Set auth listen port to $PORT in $FOUND_SITE"
fi

FREERADIUS_BIN=""
if command -v freeradius >/dev/null 2>&1; then FREERADIUS_BIN="freeradius"
elif command -v radiusd >/dev/null 2>&1; then FREERADIUS_BIN="radiusd"
fi

if [ -n "$FREERADIUS_BIN" ]; then
  if sudo "$FREERADIUS_BIN" -XC; then
    echo "Configuration syntax OK"
    echo "Run: sudo ${FREERADIUS_BIN} -X to test in foreground"
  else
    echo "Configuration check failed"
    exit 2
  fi
else
  echo "freeradius binary not found; skip syntax check"
fi

echo ""
echo "To enable/start service (Arch): sudo systemctl enable --now freeradius.service"
echo ""
echo "Export environment variables for tests:"
echo "  export RADIUS_HOST=${BIND_IP}"
echo "  export RADIUS_PORT=${PORT}"
echo "  export RADIUS_SECRET=${SECRET}"
echo "  export RADIUS_USER=${USER}"
echo "  export RADIUS_PASS=${PASS}"

echo "Done. Inspect backup files before running the daemon."