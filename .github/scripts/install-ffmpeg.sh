#!/usr/bin/env bash
set -euo pipefail

if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -version
  exit 0
fi

# The hosted runner's Azure mirror can stream packages too slowly to hit an
# idle timeout. Use Ubuntu's official archive while retaining APT signatures.
for source_file in /etc/apt/apt-mirrors.txt /etc/apt/apt-mirrors-security.txt /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
  if [ -f "$source_file" ]; then
    sudo sed -i -E 's|https?://azure\.archive\.ubuntu\.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' "$source_file"
  fi
done

sudo apt-get update -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 ffmpeg
ffmpeg -version
