#!/usr/bin/env bash
# 只读盘点：不安装、不重启、不写入任何站点文件。输出含主机信息，先本地查看。
# 用法：sudo bash preflight.sh | tee /tmp/io-preflight-$(date +%F).txt
set -u
section(){ printf '\n== %s ==\n' "$1"; }

section "os"
{ cat /etc/os-release 2>/dev/null | head -6; uname -a; } 2>/dev/null

section "node"
for bin in node npm; do command -v "$bin" >/dev/null 2>&1 && printf '%s: %s (%s)\n' "$bin" "$(command -v "$bin")" "$($bin -v 2>/dev/null)"; done
ls -d /usr/local/node* /opt/node* /opt/turboio 2>/dev/null

section "listening"
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | head -40

section "target ports"
for port in 3401 3402; do
  if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE "[:.]$port[[:space:]]"; then echo "$port BUSY"; else echo "$port free"; fi
done

section "nginx version"
nginx -v 2>&1

section "nginx server blocks and proxy lines (filtered, no full config dump)"
nginx -T 2>/dev/null | grep -nE '^\s*(server_name|listen|include|client_max_body_size)|proxy_pass' | head -60

section "tls certificates"
ls -l /etc/letsencrypt/live 2>/dev/null
for cert in /etc/letsencrypt/live/*/fullchain.pem; do [ -f "$cert" ] && openssl x509 -noout -subject -enddate -in "$cert" 2>/dev/null; done

section "resources"
free -m 2>/dev/null | head -3
df -h / /var /opt 2>/dev/null | head -8
uptime

section "pm2"
(pm2 list 2>/dev/null || echo "pm2 not in PATH for this user") | head -20

section "existing backups (names only)"
ls -l /var/backups 2>/dev/null | head -10
