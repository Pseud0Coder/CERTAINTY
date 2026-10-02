#!/usr/bin/env bash
# Baseline probes at commit 680a47b (pre-fix). Recorded as raw data.
# Usage: bash repro_baseline.sh    (run from repo root is NOT required)
set -uo pipefail

EXP_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$EXP_DIR/../.." && pwd)"
cd "$REPO"

PORT_NUM=8391
export LIVEKIT_URL=wss://fake.livekit.cloud
export LIVEKIT_API_KEY=fake-key
export LIVEKIT_API_SECRET=fake-secret-p0-experiment
export PORT=$PORT_NUM

BK="$(mktemp -d /tmp/certain-p0-backup.XXXXXX)"
if [ -f data/certain.db ]; then cp data/certain.db "$BK/" 2>/dev/null || true; fi
rm -f data/certain.db data/certain.db-wal data/certain.db-shm

SRV_PID=""
cleanup() { [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null; }
trap cleanup EXIT

node src/server/index.ts > /tmp/p0-server.log 2>&1 &
SRV_PID=$!
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "localhost:$PORT_NUM/" 2>/dev/null || true)
  [ "$code" = "200" ] && break
  sleep 0.5
done
echo "server_ready: $(curl -s -o /dev/null -w "%{http_code}" localhost:$PORT_NUM/)"

curl -s -c /tmp/p0-cj.txt -X POST "localhost:$PORT_NUM/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"nadia@gennext.demo","password":"certainty-demo"}' > /tmp/p0-login.json
CSRF=$(grep certainty_csrf /tmp/p0-cj.txt | awk '{print $7}')
CID=$(curl -s -b /tmp/p0-cj.txt "localhost:$PORT_NUM/api/me" | python3 -c "import json,sys; print(json.load(sys.stdin)['candidateId'])")
echo "candidate_id: $CID"

echo
echo "== P1: token mint without consent (H0a predicted: token minted) =="
curl -s -b /tmp/p0-cj.txt -H "x-csrf: $CSRF" -X POST "localhost:$PORT_NUM/api/candidate/livekit/token" \
  -H 'Content-Type: application/json' -d '{}' -o /tmp/p0-p1.json -w "HTTP %{http_code}\n"
python3 - <<'PY'
import json
d = json.load(open('/tmp/p0-p1.json'))
tok = d.get('token')
print('token_present:', bool(tok), '| token_len:', len(tok) if tok else 0, '| token_value: [redacted]')
print('url_returned:', d.get('url'))
if 'error' in d: print('error:', d['error'])
PY

count_artifacts() {
  node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/certain.db');console.log(d.prepare('SELECT COUNT(*) n FROM artifacts WHERE candidate_id=?').get('$CID').n)"
}

echo
echo "== P2: unsigned webhook, object metadata (H0b predicted: artifact written) =="
BEFORE=$(count_artifacts)
curl -s -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' \
  -d "{\"participant\":{\"metadata\":{\"candidateId\":\"$CID\"}},\"data\":{\"resume_bullet\":[{\"ownership\":\"injected\",\"action\":\"injected\",\"outcome\":\"injected\"}]}}" \
  -o /tmp/p0-p2.json -w "HTTP %{http_code}\n"
AFTER=$(count_artifacts)
echo "artifact_delta: $((AFTER-BEFORE))"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p2.json')))"

echo
echo "== P3: unsigned webhook, string metadata (H0c predicted: 400 missing_candidate_id) =="
META=$(python3 -c "import json;print(json.dumps(json.dumps({'candidateId':'$CID'})))")
curl -s -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' \
  -d "{\"participant\":{\"metadata\":$META},\"data\":{\"resume_bullet\":[],\"interviewer_note\":{\"evaluation_summary\":\"x\"}}}" \
  -o /tmp/p0-p3.json -w "HTTP %{http_code}\n"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p3.json')))"

echo
echo "== cleanup: server stopped, database restored =="
kill "$SRV_PID" 2>/dev/null; SRV_PID=""
sleep 0.5
rm -f data/certain.db data/certain.db-wal data/certain.db-shm
[ -f "$BK/certain.db" ] && cp "$BK/certain.db" data/certain.db
echo "restored: $(ls data/ 2>/dev/null | tr '\n' ' ')"
