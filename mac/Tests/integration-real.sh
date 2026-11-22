#!/bin/bash
# End to end against the real server (app/server/main.ts) on a temp dir: pairing with a real code, sync of
# the test folder, a resumed upload after a 409, OCR posted, second copy with ack. The Keychain and the
# Photos library are not touched; the token lives in a temp home.
set -euo pipefail
cd "$(dirname "$0")/.."
TESTDATA="${MONET_TESTDATA:?set MONET_TESTDATA to a folder of test photos (jpg, png, heic)}"
WORK="$(mktemp -d)"
BIN="$PWD/build/Monet.app/Contents/MacOS/monet"
[ -x "$BIN" ] || tools/build-app.sh
bun Tests/real_server.ts > "$WORK/srv.json" 2>"$WORK/srv.err" & SRV=$!
trap 'kill $SRV 2>/dev/null || true; sleep 0.5; rm -rf "$WORK"' EXIT
for i in $(seq 1 100); do [ -s "$WORK/srv.json" ] && break; sleep 0.2; done
BASE=$(python3 -c "import json;print(json.load(open('$WORK/srv.json'))['origin'])")
CODE=$(python3 -c "import json;print(json.load(open('$WORK/srv.json'))['code'])")
SDIR=$(python3 -c "import json;print(json.load(open('$WORK/srv.json'))['dir'])")
DB="$SDIR/monet.db"
EXPECT=$(find "$TESTDATA" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.heic' \) ! -name '.*' | wc -l | tr -d ' ')

# 40 MiB JPEG (a real photo plus zero padding): three chunks. The first 16 MiB go up by hand so the agent's
# request at offset 0 is answered 409 with the server's size and it has to resume.
mkdir -p "$WORK/big"
cat "$TESTDATA/20201101_133230.jpg" > "$WORK/big/big.jpg"
head -c 41943040 /dev/zero >> "$WORK/big/big.jpg"
TOTAL=$(stat -f %z "$WORK/big/big.jpg")
BIGSHA=$(shasum -a 256 "$WORK/big/big.jpg" | cut -d' ' -f1)
sleep 4
HOME1="$WORK/home1"; mkdir -p "$HOME1"
echo "== pair with a real code"
"$BIN" sync --home "$HOME1" --server "$BASE" --code "$CODE" --ocr-seconds 1 >/dev/null
TOKEN=$(cat "$HOME1/token")
head -c 16777216 "$WORK/big/big.jpg" | curl -fs -X PUT -H "Authorization: Bearer $TOKEN" --data-binary @- \
  "$BASE/api/upload/$BIGSHA?offset=0&total=$TOTAL&name=big.jpg&mtime=1600000000000&source=mac" >/dev/null
echo "== sync ($EXPECT test files + 1 big)"
OUT=$("$BIN" sync --home "$HOME1" --server "$BASE" --folder "$TESTDATA" --folder "$WORK/big" --ocr-seconds 120)
echo "$OUT"
sleep 1
ITEMS=$(sqlite3 "$DB" "select count(*) from item"); OCR=$(sqlite3 "$DB" "select count(*) from item where ocr_ok=1")
OCRTXT=$(sqlite3 "$DB" "select count(*) from item where length(ocr_text)>20")
SRC=$(sqlite3 "$DB" "select group_concat(distinct source) from item")
echo "server: items=$ITEMS ocr_ok=$OCR ocr_text>20=$OCRTXT source=$SRC"
python3 -c "
import json; o=json.loads('''$OUT''')
assert o['failed']==0 and o['uploaded']==$EXPECT+1, o
assert $ITEMS==$EXPECT+1 and $OCR==$EXPECT+1 and '$SRC'=='mac'"
echo "== second run is a no-op"
"$BIN" sync --home "$HOME1" --server "$BASE" --folder "$TESTDATA" --folder "$WORK/big" --ocr-seconds 1 | tee "$WORK/r2.json"
python3 -c "
import json; o=json.load(open('$WORK/r2.json')); assert o['hashed']==0 and o['uploaded']==0, o"
echo "== second copy"
mkdir -p "$WORK/archive"
A1=$("$BIN" archive --home "$HOME1" --server "$BASE" --dir "$WORK/archive"); echo "$A1"
A2=$("$BIN" archive --home "$HOME1" --server "$BASE" --dir "$WORK/archive"); echo "$A2"
N=$(find "$WORK/archive" -type f ! -path '*/.monet-tmp/*' | wc -l | tr -d ' ')
ACK=$(sqlite3 "$DB" "select count(*) from item where second_copy_at is not null")
echo "archive files=$N acked on server=$ACK"
python3 -c "
import json; a=json.loads('''$A1'''); b=json.loads('''$A2''')
assert a['copied']==$EXPECT+1 and a['failed']==0, a
assert b['copied']==0 and b['skipped']==0, b
assert $N==$EXPECT+1 and $ACK==$EXPECT+1"
BAD=0; for f in $(find "$WORK/archive" -type f); do [ "$(shasum -a 256 "$f" | cut -d' ' -f1)" = "$(basename "${f%.*}")" ] || BAD=1; done
[ $BAD = 0 ] && echo "archive hashes verified"
echo "== device session cookie"
curl -s -D - -o /dev/null -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/devices/session" | grep -i "^set-cookie" | sed 's/=[^;]*;/=<redacted>;/'
echo "real integration ok"
