#!/bin/bash
# End to end against a local server on 127.0.0.1: pairing, folder sync, 409 resume, OCR, second copy.
# Uses the real server (app/server/main.ts) when SERVER=real is set and it exists, else Tests/mock_server.py.
# Never touches the Keychain (the headless commands keep the token in the temp home), never the Photos
# library, and only uploads the test data folder plus a generated file.
set -euo pipefail
cd "$(dirname "$0")/.."
TESTDATA="${MONET_TESTDATA:?set MONET_TESTDATA to a folder of test photos (jpg, png, heic)}"
PORT="${PORT:-4391}"
WORK="$(mktemp -d)"
trap 'kill $SRV 2>/dev/null || true; rm -rf "$WORK"' EXIT
BIN="$PWD/build/Monet.app/Contents/MacOS/monet"
[ -x "$BIN" ] || tools/build-app.sh
BASE="http://127.0.0.1:$PORT"

if [ "${SERVER:-mock}" = real ]; then
  echo "real server mode: set MONET_* env and a pairing code in CODE" >&2
  CODE="${CODE:?}"
  MONET_DB="$WORK/db.sqlite" MONET_DATA="$WORK/data" MONET_ORIGINALS="$WORK/orig" PORT=$PORT HOST=127.0.0.1 MONET_ORIGIN="$BASE" \
    bun ../app/server/main.ts >"$WORK/server.log" 2>&1 & SRV=$!
else
  CODE=ABCD2345
  python3 Tests/mock_server.py "$PORT" "$WORK/srv" & SRV=$!
fi
for i in $(seq 1 50); do curl -fs "$BASE/healthz" >/dev/null && break; sleep 0.2; done

EXPECT=$(find "$TESTDATA" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.heic' \) ! -name '.*' | wc -l | tr -d ' ')
# A 40 MiB file: three chunks. Its first 16 MiB are put on the server by hand first, so the agent's
# first request (offset 0) gets a 409 with the server's offset and has to resume from it.
mkdir -p "$WORK/big"
head -c 41943040 /dev/urandom > "$WORK/big/clip.mp4"
BIGSHA=$(shasum -a 256 "$WORK/big/clip.mp4" | cut -d' ' -f1)
sleep 4   # the agent skips files touched in the last 3 seconds (still being written)
echo "== pair + first sync ($EXPECT test photos + 1 big file)"
# pair first, with an empty folder list, so the manual partial upload below can use the token
HOME1="$WORK/home1"; mkdir -p "$HOME1"
"$BIN" sync --home "$HOME1" --server "$BASE" --code "$CODE" --ocr-seconds 1 >/dev/null
TOKEN=$(cat "$HOME1/token")
head -c 16777216 "$WORK/big/clip.mp4" | curl -fs -X PUT -H "Authorization: Bearer $TOKEN" --data-binary @- \
  "$BASE/api/upload/$BIGSHA?offset=0&total=41943040&name=clip.mp4&mtime=1&source=mac" >/dev/null
OUT=$("$BIN" sync --home "$HOME1" --server "$BASE" --folder "$TESTDATA" --folder "$WORK/big" --ocr-seconds 90)
echo "$OUT"
STATE=$(curl -fs "$BASE/_test/state")
echo "$STATE" | python3 -c "
import json,sys
s=json.load(sys.stdin); o=json.loads('''$OUT''')
exp=$EXPECT+1
assert o['files']==exp, ('files',o['files'],exp)
assert o['uploaded']==exp, ('uploaded',o['uploaded'],exp)
assert o['failed']==0, o
assert s['items']==exp, ('items on server',s['items'])
assert any(l.startswith('409') for l in s['log']), 'no 409 resume happened'
assert len(s['ocr'])==$EXPECT, ('ocr posted',len(s['ocr']))
shots=[t for t in s['ocr'].values() if len(t)>20]
print('server items:',s['items'],'| ocr texts:',len(s['ocr']),'| with text >20 chars:',len(shots))
print('sample ocr:',repr(max(s['ocr'].values(),key=len)[:90]))
print('409 lines:',[l for l in s['log'] if l.startswith('409')])
"
echo "== second run, same home: nothing hashed, nothing uploaded"
"$BIN" sync --home "$HOME1" --server "$BASE" --folder "$TESTDATA" --folder "$WORK/big" --ocr-seconds 1 | tee "$WORK/run2.json"
python3 -c "
import json; o=json.load(open('$WORK/run2.json')); assert o['hashed']==0 and o['uploaded']==0 and o['alreadyThere']==o['files'], o"
echo "== fresh home (state lost), OCR text again via /media/id/l"
curl -fs "$BASE/_test/reset-ocr" >/dev/null
HOME2="$WORK/home2"; mkdir -p "$HOME2"; cp "$HOME1/token" "$HOME2/token"
"$BIN" sync --home "$HOME2" --server "$BASE" --folder "$TESTDATA" --ocr-seconds 60 | tee "$WORK/run3.json"
python3 -c "
import json; o=json.load(open('$WORK/run3.json')); assert o['uploaded']==0 and o['ocrPosted']==$EXPECT, o"
echo "== second copy"
# a missing target (disk not connected) must fail and must not create the folder
if "$BIN" archive --home "$HOME1" --server "$BASE" --dir "$WORK/archive" 2>/dev/null; then echo "archive wrote to a missing folder"; exit 1; fi
[ ! -e "$WORK/archive" ] && echo "missing archive folder: refused, not created"
mkdir -p "$WORK/archive"
A1=$("$BIN" archive --home "$HOME1" --server "$BASE" --dir "$WORK/archive"); echo "$A1"
A2=$("$BIN" archive --home "$HOME1" --server "$BASE" --dir "$WORK/archive"); echo "$A2"
N=$(find "$WORK/archive" -type f ! -path '*/.monet-tmp/*' | wc -l | tr -d ' ')
echo "files in archive: $N"
python3 -c "
import json; a=json.loads('''$A1'''); b=json.loads('''$A2''')
assert a['copied']==$EXPECT+1 and a['failed']==0, a
assert b['copied']==0, b
assert $N==$EXPECT+1"
# every archived file is named by its own hash
BAD=0; for f in $(find "$WORK/archive" -type f); do [ "$(shasum -a 256 "$f" | cut -d' ' -f1)" = "$(basename "${f%.*}")" ] || BAD=1; done
[ $BAD = 0 ] && echo "archive hashes verified"
echo "integration ok"
