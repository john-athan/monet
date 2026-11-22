#!/usr/bin/env bash
# Monet's server-side preparation, run as root by the template's install.sh before the build is swapped in.
set -euo pipefail
# libvips makes thumbnails and reads HEIC and PDF, ffmpeg handles video, unzip and rsync are for GeoNames and the models,
# poppler-utils gives the text of documents, LibreOffice turns documents, sheets and slides into PDF and CSV
# (docs/files.md). kaleve-home is a laptop with the desktop LibreOffice: the nogui packages only where there is none.
need=""; for p in libvips-tools ffmpeg unzip rsync poppler-utils; do dpkg -s $p >/dev/null 2>&1 || need="$need $p"; done
command -v soffice >/dev/null || need="$need libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui"
[ -z "$need" ] || apt-get install -y -qq --no-install-recommends $need >/dev/null
id monet >/dev/null 2>&1 || useradd --system --home-dir /var/lib/monet --shell /usr/sbin/nologin monet
install -d -o monet -g monet -m 700 /var/lib/monet /var/lib/monet/models /var/lib/monet/geonames
# GeoNames once: cities of 15000 people and up, plus the state names
if [ ! -s /var/lib/monet/geonames/cities15000.txt ]; then
  cd /var/lib/monet/geonames
  curl -fsSL -O https://download.geonames.org/export/dump/cities15000.zip
  curl -fsSL -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
  unzip -oq cities15000.zip && rm -f cities15000.zip
  chown -R monet:monet /var/lib/monet/geonames
fi
