#!/bin/sh
set -eu

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl docker.io docker-compose-v2 git
systemctl enable --now docker

install -d -m 0755 /opt/habit-tracker
if [ ! -d /opt/habit-tracker/.git ]; then
  git clone --depth 1 https://github.com/mhdnaseeel/habit-tracker.git /opt/habit-tracker
fi

install -m 0644 /opt/habit-tracker/deploy/aws/habit-tracker.service \
  /etc/systemd/system/habit-tracker.service
systemctl daemon-reload
systemctl enable habit-tracker.service

cat >/etc/motd <<'EOF'
Habit Tracker prerequisites are installed.
Create /opt/habit-tracker/.env.aws with mode 0600, then run:
  sudo systemctl start habit-tracker
EOF
