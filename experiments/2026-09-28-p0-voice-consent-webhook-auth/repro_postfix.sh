#!/usr/bin/env bash
# Post-fix probes. Identical structure to baseline, plus consent-chain probes.
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
IRIS=$(node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/certain.db');const r=d.prepare(\"SELECT id FROM candidates WHERE name='Iris Vale'\").get();console.log(r?r.id:'')")
echo "candidate_id: $CID"
echo "control_candidate (no session): $IRIS"

echo
echo "== P1a: token mint with no chain (H1a predicted: 409, no token) =="
curl -s -b /tmp/p0-cj.txt -H "x-csrf: $CSRF" -X POST "localhost:$PORT_NUM/api/candidate/livekit/token" \
  -H 'Content-Type: application/json' -d '{}' -o /tmp/p0-p1a.json -w "HTTP %{http_code}\n"
python3 -c "import json;d=json.load(open('/tmp/p0-p1a.json'));print('token_present:', 'token' in d, '| error:', d.get('error'))"

echo
echo "== P1b: run exists, consent not granted (H1a predicted: 409, no token) =="
RUN=$(curl -s -b /tmp/p0-cj.txt -H "x-csrf: $CSRF" -X POST "localhost:$PORT_NUM/api/candidate/flows/interview_screener/start" \
  -H 'Content-Type: application/json' -d '{"mode":"verified"}')
RUNID=$(echo "$RUN" | python3 -c "import json,sys;print(json.load(sys.stdin)['run']['id'])")
echo "run_id: $RUNID (step: $(echo "$RUN" | python3 -c "import json,sys;print(json.load(sys.stdin)['run']['currentStep'])"))"
curl -s -b /tmp/p0-cj.txt -H "x-csrf: $CSRF" -X POST "localhost:$PORT_NUM/api/candidate/livekit/token" \
  -H 'Content-Type: application/json' -d "{\"runId\":\"$RUNID\"}" -o /tmp/p0-p1b.json -w "HTTP %{http_code}\n"
python3 -c "import json;d=json.load(open('/tmp/p0-p1b.json'));print('token_present:', 'token' in d, '| error:', d.get('error'))"

echo
echo "== P1c: full chain (consent granted) (H1a predicted: token) =="
curl -s -b /tmp/p0-cj.txt -H "x-csrf: $CSRF" -X POST "localhost:$PORT_NUM/api/flows/runs/$RUNID/consent" \
  -H 'Content-Type: application/json' -d '{"scope":"recording and sharing"}' > /tmp/p0-consent.json
curl -s -b /tmp/p0-cj.txt -H "x-csrf: $CSRF" -X POST "localhost:$PORT_NUM/api/candidate/livekit/token" \
  -H 'Content-Type: application/json' -d "{\"runId\":\"$RUNID\"}" -o /tmp/p0-p1c.json -w "HTTP %{http_code}\n"
python3 - <<'PY'
import json, base64
d = json.load(open('/tmp/p0-p1c.json'))
tok = d.get('token')
print('token_present:', bool(tok), '| url_returned:', bool(d.get('url')))
if tok:
    payload = tok.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    print('claims.iss:', claims.get('iss'), '| claims.exp_present:', 'exp' in claims)
    meta = json.loads(claims.get('metadata', '{}'))
    print('metadata keys:', sorted(meta.keys()))
    print('session_id:', meta.get('sessionId'), '| consent_id:', meta.get('consentId'))
PY
SID=$(node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/certain.db');const r=d.prepare(\"SELECT id FROM sessions WHERE candidate_id='$CID' ORDER BY created_at DESC LIMIT 1\").get();console.log(r?r.id:'')")
CONS=$(node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/certain.db');const r=d.prepare(\"SELECT id FROM consents WHERE candidate_id='$CID' ORDER BY created_at DESC LIMIT 1\").get();console.log(r?r.id:'')")
echo "db session_id: $SID | db consent_id: $CONS"

count_artifacts() {
  node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/certain.db');console.log(d.prepare('SELECT COUNT(*) n FROM artifacts WHERE candidate_id=?').get('$1').n)"
}

echo
echo "== P2a: unsigned webhook, string metadata (H1b predicted: 401, delta 0) =="
META_STR=$(python3 -c "import json;print(json.dumps(json.dumps({'candidateId':'$CID'})))")
BEFORE=$(count_artifacts "$CID")
curl -s -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' \
  -d "{\"participant\":{\"metadata\":$META_STR},\"data\":{\"resume_bullet\":[{\"ownership\":\"x\",\"action\":\"y\",\"outcome\":\"z\"}]}}" \
  -o /tmp/p0-p2a.json -w "HTTP %{http_code}\n"
AFTER=$(count_artifacts "$CID")
echo "artifact_delta: $((AFTER-BEFORE))"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p2a.json')))"

echo
echo "== P2a2: signed with the WRONG secret (H1b predicted: 401, delta 0) =="
BODY="{\"participant\":{\"metadata\":$META_STR},\"data\":{\"resume_bullet\":[{\"ownership\":\"x\",\"action\":\"y\",\"outcome\":\"z\"}]}}"
BADTOK=$(LIVEKIT_API_SECRET=wrong-secret node "$EXP_DIR/sign_webhook.mjs" "$BODY")
BEFORE=$(count_artifacts "$CID")
curl -s -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' -H "Authorization: $BADTOK" \
  -d "$BODY" -o /tmp/p0-p2a2.json -w "HTTP %{http_code}\n"
AFTER=$(count_artifacts "$CID")
echo "artifact_delta: $((AFTER-BEFORE))"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p2a2.json')))"

echo
echo "== P2b: signed, control candidate with NO active session (H1b predicted: 409, delta 0) =="
IMETA=$(python3 -c "import json;print(json.dumps(json.dumps({'candidateId':'$IRIS'})))")
IBODY="{\"participant\":{\"metadata\":$IMETA},\"data\":{\"resume_bullet\":[{\"ownership\":\"x\",\"action\":\"y\",\"outcome\":\"z\"}]}}"
ITOK=$(node "$EXP_DIR/sign_webhook.mjs" "$IBODY")
BEFORE=$(count_artifacts "$IRIS")
curl -s -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' -H "Authorization: $ITOK" \
  -d "$IBODY" -o /tmp/p0-p2b.json -w "HTTP %{http_code}\n"
AFTER=$(count_artifacts "$IRIS")
echo "artifact_delta: $((AFTER-BEFORE))"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p2b.json')))"

echo
echo "== P2c: signed, in-consent session, bullet + note (H1b predicted: 200, delta 2, linked) =="
SMETA=$(python3 -c "import json;print(json.dumps(json.dumps({'candidateId':'$CID','sessionId':'$SID','consentId':'$CONS'})))")
CBODY="{\"participant\":{\"metadata\":$SMETA},\"data\":{\"resume_bullet\":[{\"ownership\":\"owned the migration\",\"action\":\"migrated the service\",\"outcome\":\"zero downtime\"}],\"interviewer_note\":{\"evaluation_summary\":\"strong ownership\"}}}"
CTOK=$(node "$EXP_DIR/sign_webhook.mjs" "$CBODY")
BEFORE=$(count_artifacts "$CID")
curl -s -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' -H "Authorization: $CTOK" \
  -d "$CBODY" -o /tmp/p0-p2c.json -w "HTTP %{http_code}\n"
AFTER=$(count_artifacts "$CID")
echo "artifact_delta: $((AFTER-BEFORE))"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p2c.json')))"
node -e "
const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/certain.db');
const rows=d.prepare(\"SELECT kind, fields FROM artifacts WHERE candidate_id=? ORDER BY created_at DESC LIMIT 2\").all('$CID');
for (const r of rows.reverse()) { const f=JSON.parse(r.fields); console.log('artifact', r.kind, '| sessionId:', f.sessionId, '| consentId:', f.consentId); }
"

echo
echo "== P3a: signed, room name only, no metadata (H1c predicted: resolves, 200) =="
RBODY='{"room":{"name":"interview-'$CID'"},"data":{"resume_bullet":[{"ownership":"x","action":"y","outcome":"z"}]}}'
RTOK=$(node "$EXP_DIR/sign_webhook.mjs" "$RBODY")
BEFORE=$(count_artifacts "$CID")
curl -s -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' -H "Authorization: $RTOK" \
  -d "$RBODY" -o /tmp/p0-p3a.json -w "HTTP %{http_code}\n"
AFTER=$(count_artifacts "$CID")
echo "artifact_delta: $((AFTER-BEFORE))"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p3a.json')))"

echo
echo "== P3b: signed, no identity anywhere (H1c predicted: 400, delta 0) =="
NBODY='{"data":{"resume_bullet":[{"ownership":"x","action":"y","outcome":"z"}]}}'
NTOK=$(node "$EXP_DIR/sign_webhook.mjs" "$NBODY")
BEFORE=$(count_artifacts "$CID")
curl -s -X POST "localhost:$PORT_NUM/api/webhooks/livekit" -H 'Content-Type: application/json' -H "Authorization: $NTOK" \
  -d "$NBODY" -o /tmp/p0-p3b.json -w "HTTP %{http_code}\n"
AFTER=$(count_artifacts "$CID")
echo "artifact_delta: $((AFTER-BEFORE))"
python3 -c "import json;print('response:', json.load(open('/tmp/p0-p3b.json')))"

echo
echo "== cleanup: server stopped, database restored =="
kill "$SRV_PID" 2>/dev/null; SRV_PID=""
sleep 0.5
rm -f data/certain.db data/certain.db-wal data/certain.db-shm
[ -f "$BK/certain.db" ] && cp "$BK/certain.db" data/certain.db
echo "restored: $(ls data/ 2>/dev/null | tr '\n' ' ')"
