#!/usr/bin/env python3
"""A small stand-in for the Monet server's device API, used by Tests/integration.sh while the
real server is not available. It speaks the contract in docs/spec.md (claim, check, chunked PUT
with 409 resume, index pending/post, media, export list) and keeps everything in memory plus a
data dir. Test only, not part of the app."""
import hashlib, json, os, sys, threading, secrets
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

DATA = sys.argv[2]
PORT = int(sys.argv[1])
CODE = "ABCD2345"
STATE = {"token": None, "items": {}, "next": 1, "part": {}, "ocr": {}, "log": []}
LOCK = threading.Lock()
os.makedirs(DATA, exist_ok=True)

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def send_json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""
    def authed(self):
        ok = STATE["token"] and self.headers.get("Authorization") == "Bearer " + STATE["token"]
        if not ok: self.send_json({"error": "unauthorized"}, 401)
        return ok
    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == "/healthz": return self.send_json({"ok": True})
        if u.path == "/_test/state":
            return self.send_json({"items": len(STATE["items"]), "ocr": {str(k): v for k, v in STATE["ocr"].items()}, "log": STATE["log"]})
        if u.path == "/_test/reset-ocr":
            STATE["ocr"].clear(); return self.send_json({"ok": True})
        if not self.authed(): return
        if u.path == "/api/index/pending":
            out = []
            for it in STATE["items"].values():
                needs = ["clip", "faces"] + ([] if it["id"] in STATE["ocr"] else ["ocr"])
                out.append({"id": it["id"], "kind": it["kind"], "needs": needs})
            return self.send_json(out[: int(q.get("limit", ["20"])[0])])
        if u.path == "/api/export/list":
            after = int(q.get("after", ["0"])[0])
            return self.send_json([{"id": i["id"], "sha256": i["sha"], "ext": i["ext"], "bytes": i["bytes"], "takenAt": i["mtime"]}
                                   for i in sorted(STATE["items"].values(), key=lambda x: x["id"]) if i["id"] > after])
        p = u.path.split("/")
        if len(p) == 4 and p[1] == "media":
            it = next((i for i in STATE["items"].values() if i["id"] == int(p[2])), None)
            if not it: return self.send_json({"error": "nf"}, 404)
            data = open(it["path"], "rb").read()
            self.send_response(200); self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        self.send_json({"error": "nf"}, 404)
    def do_POST(self):
        u = urlparse(self.path); b = self.body()
        if u.path == "/api/devices/claim":
            j = json.loads(b or b"{}")
            if j.get("code") != CODE or j.get("kind") != "mac" or not j.get("name"):
                return self.send_json({"error": "invalid code"}, 400)
            STATE["token"] = secrets.token_hex(32); STATE["code_used"] = True
            return self.send_json({"token": STATE["token"], "deviceId": 1})
        if not self.authed(): return
        if u.path == "/api/upload/check":
            hs = json.loads(b)["hashes"]
            have = {i["sha"] for i in STATE["items"].values()}
            STATE["log"].append("check %d" % len(hs))
            return self.send_json({"missing": [h for h in hs if h not in have]})
        p = u.path.split("/")
        if len(p) == 4 and p[1] == "api" and p[2] == "index":
            j = json.loads(b)
            if j.get("model") == "vision-ocr": STATE["ocr"][int(p[3])] = j.get("ocr", "")
            return self.send_json({"ok": True})
        self.send_json({"error": "nf"}, 404)
    def do_PUT(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}; b = self.body()
        if not self.authed(): return
        sha = u.path.split("/")[-1]; off = int(q["offset"]); total = int(q["total"])
        part = os.path.join(DATA, sha + ".part")
        have = os.path.getsize(part) if os.path.exists(part) else 0
        if off != have:
            STATE["log"].append("409 %s off=%d have=%d" % (sha[:8], off, have))
            return self.send_json({"received": have}, 409)
        with open(part, "ab") as f: f.write(b)
        have += len(b)
        if have < total: return self.send_json({"received": have})
        h = hashlib.sha256(open(part, "rb").read()).hexdigest()
        if h != sha:
            os.remove(part); return self.send_json({"error": "hash mismatch"}, 422)
        final = os.path.join(DATA, sha); os.replace(part, final)
        with LOCK:
            dup = any(i["sha"] == sha for i in STATE["items"].values())
            if not dup:
                iid = STATE["next"]; STATE["next"] += 1
                ext = os.path.splitext(q.get("name", ""))[1].lstrip(".").lower()
                STATE["items"][iid] = {"id": iid, "sha": sha, "ext": ext, "bytes": total, "path": final, "mtime": int(q["mtime"]),
                                        "kind": "video" if ext in ("mp4", "mov") else "photo", "name": q.get("name")}
            item = next(i for i in STATE["items"].values() if i["sha"] == sha)
        self.send_json({"item": {"id": item["id"], "kind": item["kind"]}, "duplicate": dup})

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
