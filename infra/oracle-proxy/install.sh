#!/usr/bin/env bash
# =============================================================================
# familiacb — proxy de saída com IP fixo para a API do Mercado Bitcoin
#
# Roda numa VM Ubuntu 22.04/24.04 "Always Free" da Oracle Cloud.
#
#   Vercel ──TLS (cert fixado + senha)──▶ stunnel :8443 ──▶ tinyproxy (127.0.0.1:8888)
#                                                              │  só aceita CONNECT para
#                                                              ▼  api.mercadobitcoin.net:443
#                                                     Mercado Bitcoin (TLS ponta a ponta)
#
# O proxy nunca vê tokens, ordens ou valores: o tráfego até o MB continua cifrado.
#
# Uso:   sudo bash install.sh
# Saída: as duas variáveis para colar no Vercel (MB_EGRESS_PROXY_URL e MB_EGRESS_PROXY_CA)
# =============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Rode com sudo."; exit 1; fi

PORT=8443
PROXY_USER="familiacb"
PROXY_PASS="$(openssl rand -hex 24)"
PUBLIC_IP="$(curl -fsS https://api.ipify.org || true)"

echo "==> Atualizando o sistema e instalando pacotes"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y tinyproxy stunnel4 openssl unattended-upgrades iptables-persistent
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Configurando tinyproxy (somente local, somente Mercado Bitcoin)"
cat > /etc/tinyproxy/filter <<'EOF'
^api\.mercadobitcoin\.net$
EOF

cat > /etc/tinyproxy/tinyproxy.conf <<EOF
User tinyproxy
Group tinyproxy
Port 8888
Listen 127.0.0.1
Timeout 60
MaxClients 20
Allow 127.0.0.1
BasicAuth ${PROXY_USER} ${PROXY_PASS}
DisableViaHeader Yes
LogLevel Notice
Syslog On
# Só túnel HTTPS (CONNECT) para a porta 443
ConnectPort 443
# Lista de permissão: tudo que não está no filtro é bloqueado
Filter "/etc/tinyproxy/filter"
FilterExtended On
FilterDefaultDeny Yes
FilterCaseSensitive Off
EOF
chmod 640 /etc/tinyproxy/tinyproxy.conf
chgrp tinyproxy /etc/tinyproxy/tinyproxy.conf

echo "==> Gerando certificado TLS próprio (será fixado no app)"
mkdir -p /etc/stunnel
openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
  -keyout /etc/stunnel/familiacb.key -out /etc/stunnel/familiacb.crt \
  -subj "/CN=familiacb-proxy" -addext "subjectAltName=DNS:familiacb-proxy" >/dev/null 2>&1
chmod 600 /etc/stunnel/familiacb.key

cat > /etc/stunnel/familiacb.conf <<EOF
setuid = stunnel4
setgid = stunnel4
pid = /var/run/stunnel4/familiacb.pid
[familiacb]
accept = 0.0.0.0:${PORT}
connect = 127.0.0.1:8888
cert = /etc/stunnel/familiacb.crt
key = /etc/stunnel/familiacb.key
sslVersionMin = TLSv1.2
EOF
chown stunnel4:stunnel4 /etc/stunnel/familiacb.key
sed -i 's/^ENABLED=0/ENABLED=1/' /etc/default/stunnel4 2>/dev/null || true
mkdir -p /var/run/stunnel4 && chown stunnel4:stunnel4 /var/run/stunnel4

echo "==> Firewall: libera só SSH e a porta ${PORT}"
iptables -C INPUT -p tcp --dport ${PORT} -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport ${PORT} -m state --state NEW -j ACCEPT
netfilter-persistent save >/dev/null

systemctl enable --now tinyproxy
systemctl restart tinyproxy
systemctl enable --now stunnel4 2>/dev/null || systemctl enable --now stunnel
systemctl restart stunnel4 2>/dev/null || systemctl restart stunnel

echo "==> Teste local (deve responder 200: livro público do MB via proxy)"
curl -s -o /dev/null -w "%{http_code}\n" --proxy "http://${PROXY_USER}:${PROXY_PASS}@127.0.0.1:8888" https://api.mercadobitcoin.net/api/v4/USDT-BRL/orderbook?limit=1 || true
echo "==> Teste de bloqueio (deve FALHAR: destino não permitido)"
curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 --proxy "http://${PROXY_USER}:${PROXY_PASS}@127.0.0.1:8888" https://example.com || true

CA_B64="$(base64 -w0 /etc/stunnel/familiacb.crt)"
cat <<EOF

=============================================================================
 Pronto. IP público desta VM: ${PUBLIC_IP:-<veja no console da Oracle>}

 1) Na Oracle Cloud: VCN → Security List → adicione Ingress TCP ${PORT} (origem 0.0.0.0/0).
 2) No Mercado Bitcoin: cadastre o IP ${PUBLIC_IP:-<IP>} no Saque Automatizado.
 3) No Vercel → Settings → Environment Variables (Production), cole:

MB_EGRESS_PROXY_URL=https://${PROXY_USER}:${PROXY_PASS}@${PUBLIC_IP:-SEU_IP}:${PORT}
MB_EGRESS_PROXY_CA=${CA_B64}

 Guarde a senha num cofre. Ela não fica salva em nenhum outro lugar além desta VM.
=============================================================================
EOF
