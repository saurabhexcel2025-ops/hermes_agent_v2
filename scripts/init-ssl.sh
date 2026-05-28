#!/bin/bash
# One-time SSL bootstrap — run once after DNS is pointed at this server.
# Usage: bash scripts/init-ssl.sh

set -e

DOMAIN="mc.spacearmour.io"
EMAIL="shubhambhatt9082003@gmail.com"
COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Hermes SSL Bootstrap ==="
echo "Domain : $DOMAIN"
echo "Email  : $EMAIL"
echo ""

# ── 1. Install certbot on host ─────────────────────────────────────
if ! command -v certbot &>/dev/null; then
    echo "Installing certbot..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq certbot
fi

# ── 2. Get certificate (standalone — nginx not on 80 yet) ──────────
# If already have cert, just renew/skip
if sudo certbot certificates 2>/dev/null | grep -q "$DOMAIN"; then
    echo "Certificate already exists. Renewing if needed..."
    sudo certbot renew --quiet
else
    echo "Requesting certificate from Let's Encrypt..."
    # Make sure nothing is on port 80
    sudo docker compose -f "$COMPOSE_DIR/docker-compose.yml" stop nginx 2>/dev/null || true

    sudo certbot certonly \
        --standalone \
        --non-interactive \
        --agree-tos \
        --no-eff-email \
        --email "$EMAIL" \
        -d "$DOMAIN"
fi

# ── 3. Start everything (nginx will find the cert) ─────────────────
echo ""
echo "Starting all services..."
cd "$COMPOSE_DIR"
sudo docker compose up -d

# ── 4. Wire up auto-renewal via cron ──────────────────────────────
CRON_JOB="0 3 * * * certbot renew --quiet --deploy-hook 'docker exec hermes_nginx nginx -s reload'"
( sudo crontab -l 2>/dev/null | grep -v "certbot renew"; echo "$CRON_JOB" ) | sudo crontab -

echo ""
echo "=== Done! ==="
echo "Visit: https://$DOMAIN"
echo "Auto-renewal cron installed (daily at 3am)."
