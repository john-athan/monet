#!/usr/bin/env bash
# Monet's server-side preparation, run as root by the template's install.sh before the build is swapped in.
set -euo pipefail
# libvips makes thumbnails and reads HEIC and PDF, ffmpeg handles video, unzip and rsync are for GeoNames and the models,
# poppler-utils gives the text of documents, LibreOffice turns documents, sheets and slides into PDF and CSV
# (docs/files.md). kaleve-home is a laptop with the desktop LibreOffice: the nogui packages only where there is none.
need=""; for p in libvips-tools ffmpeg unzip rsync poppler-utils; do dpkg -s $p >/dev/null 2>&1 || need="$need $p"; done
command -v soffice >/dev/null || need="$need libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui"
[ -z "$need" ] || apt-get install -y -qq --no-install-recommends $need >/dev/null
# Monet's own LibreOffice (docs/files.md): the distribution's 24.2 reads no current Numbers file. The official packages
# are unpacked, not installed, so the desktop LibreOffice of this laptop stays as it is. MONET_SOFFICE in the unit.
LO_VER=26.8.3 LO_SHA=e7cd3538e85818ff9dd9bb65386769fde927011242aace5a144989f4000dcabf LO_DIR=/opt/monet-libreoffice
if [ "$(cat $LO_DIR/.version 2>/dev/null)" != "$LO_VER" ]; then
  t=$(mktemp -d)
  curl -fsSL -o "$t/lo.tgz" "https://download.documentfoundation.org/libreoffice/stable/$LO_VER/deb/x86_64/LibreOffice_${LO_VER}_Linux_x86-64_deb.tar.gz"
  echo "$LO_SHA  $t/lo.tgz" | sha256sum -c --quiet
  tar xzf "$t/lo.tgz" -C "$t" && mkdir "$t/root"
  for d in "$t"/*/DEBS/*.deb; do case "$d" in *desktop-integration*) ;; *) dpkg-deb -x "$d" "$t/root" ;; esac; done
  rm -rf "$LO_DIR" && mv "$t"/root/opt/libreoffice* "$LO_DIR" && echo "$LO_VER" > "$LO_DIR/.version" && rm -rf "$t"
fi
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
