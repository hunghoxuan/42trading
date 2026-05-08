#!/usr/bin/env bash
set -euo pipefail

# Delete all files uploaded to Anthropic's Claude API.
# Also cleans up local Claude file map caches.
#
# Usage:
#   bash scripts/ops/delete_all_claude_files.sh
#   CLAUDE_API_KEY=sk-ant-xxx bash scripts/ops/delete_all_claude_files.sh  (if key known)
#   DRY_RUN=1 bash scripts/ops/delete_all_claude_files.sh                   (list only)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-mt5_bridge}"
DB_USER="${DB_USER:-mt5_user}"
DB_PASS="${DB_PASS:-d6820a26247b22feb567cbfedf7ee316674c19e5a81ad52d}"
DRY_RUN="${DRY_RUN:-0}"

echo "=== Delete Claude API Files ==="
echo ""

# --- Get Claude API key ---
CLAUDE_KEY="${CLAUDE_API_KEY:-}"
if [[ -z "$CLAUDE_KEY" ]]; then
  echo "[1/3] Fetching CLAUDE_API_KEY from database..."

  CLAUDE_KEY=$(node -e "
    const { Pool } = require('pg');
    const pool = new Pool({
      host: '$DB_HOST', port: $DB_PORT,
      database: '$DB_NAME', user: '$DB_USER', password: '$DB_PASS',
    });
    (async () => {
      const res = await pool.query(
        \"SELECT name, data FROM user_settings WHERE type = 'api_key'\"
      );
      for (const row of res.rows) {
        const name = String(row.name || '').toUpperCase();
        if (!['CLAUDE','ANTHROPIC','CLAUDE_KEY','ANTHROPIC_API_KEY','CLAUDE_API_KEY'].includes(name)) continue;
        const data = row.data && typeof row.data === 'object' ? row.data : {};
        const crypto = require('crypto');
        const ENC_KEY = (process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef').substring(0, 32);
        function decrypt(text) {
          if (!text || !text.includes(':')) return text;
          const parts = text.split(':');
          if (parts.length !== 3) return text;
          try {
            const iv = Buffer.from(parts[0], 'hex');
            const tag = Buffer.from(parts[1], 'hex');
            const key = Buffer.from(ENC_KEY, 'utf8');
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            let dec = decipher.update(parts[2], 'hex', 'utf8');
            dec += decipher.final('utf8');
            return dec;
          } catch (e) { return text; }
        }
        const raw = data.value || data.api_key || '';
        const key = raw.includes(':') ? decrypt(raw) : raw;
        if (key) { console.log(key.trim()); process.exit(0); }
      }
      console.error('CLAUDE_API_KEY not found');
      process.exit(1);
    })().catch(e => { console.error(e.message); process.exit(1); });
  " 2>/dev/null)

  if [[ -z "$CLAUDE_KEY" ]]; then
    echo "ERROR: Could not retrieve CLAUDE_API_KEY."
    echo "Set CLAUDE_API_KEY env var and retry."
    exit 1
  fi
fi

echo "  Key: ${CLAUDE_KEY:0:12}..."
echo ""

# --- List files ---
echo "[2/3] Fetching file list from Claude API..."

FILES_JSON=$(curl -fsS "https://api.anthropic.com/v1/files" \
  -H "x-api-key: $CLAUDE_KEY" \
  -H "anthropic-version: 2023-06-01" 2>&1) || {
  echo "ERROR: $FILES_JSON"
  exit 1
}

FILE_IDS=$(echo "$FILES_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
files = data.get('data', [])
for f in files:
    print(f\"{f.get('id','')}|{f.get('filename','?')}|{f.get('created_at','?')}\")
" 2>/dev/null)

FILE_COUNT=$(echo "$FILE_IDS" | grep -c . || echo 0)
echo "  Found $FILE_COUNT files"
echo ""

if [[ "$FILE_COUNT" == "0" ]]; then
  echo "  No files to delete."
else
  echo "$FILE_IDS" | while IFS='|' read -r fid fname fdate; do
    echo "  $fid  $fname  ($fdate)"
  done
  echo ""

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY RUN] Would delete $FILE_COUNT files. Set DRY_RUN=0 to execute."
  else
    echo "[3/3] Deleting $FILE_COUNT files..."
    DELETED=0
    FAILED=0
    echo "$FILE_IDS" | while IFS='|' read -r fid fname fdate; do
      [[ -z "$fid" ]] && continue
      RESULT=$(curl -fsS -X DELETE "https://api.anthropic.com/v1/files/$fid" \
        -H "x-api-key: $CLAUDE_KEY" \
        -H "anthropic-version: 2023-06-01" 2>&1) && {
        echo "  DELETED: $fname"
        DELETED=$((DELETED+1))
      } || {
        echo "  FAILED:  $fname - $RESULT"
        FAILED=$((FAILED+1))
      }
    done
    echo ""
    echo "  Done."
  fi
fi

# --- Clean local maps ---
echo ""
echo "Cleaning local Claude file maps..."
for map in webhook/chart_snapshots/.claude-files.json webhook/chart_snapshots_ai_context/.claude-context-files.json; do
  if [[ -f "$map" ]]; then
    echo '{}' > "$map"
    echo "  Cleared: $map"
  fi
done

echo ""
echo "=== Done ==="
