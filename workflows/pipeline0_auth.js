// ============================================================
// Pipeline 0 – Authorization Check (Code Node)
// Runs AFTER the NocoDB "Auth: Find User" HTTP GET node.
// Checks whether the user holds any of the three allowed
// access levels and produces an `authorized` boolean plus
// a denial Telegram body when access is refused.
//
// NocoDB Users table columns used:
//   • "Telegram ID"  – string, matched against incoming tg_id
//   • "Priority"     – boolean / "true" string
//   • "Status"       – string: "Admin" | "Free unlimited access" | …
// ============================================================

const item = $input.first();

// ── 1. Pull the NocoDB response ──────────────────────────────
// The upstream HTTP node queries:
//   GET /api/v1/db/data/noco/{projectId}/Users
//     ?where=(Telegram ID,eq,{tg_id})&limit=1
// and its output is available directly on $input.

const nocoResp = item.json;
const userRecord = (nocoResp.list && nocoResp.list.length > 0)
  ? nocoResp.list[0]
  : null;

// ── 2. Evaluate access rules ─────────────────────────────────
let authorized = false;

if (userRecord) {
  const priority = userRecord['Priority'];
  const status   = userRecord['Status'] ?? '';

  const isPriority         = priority === true || priority === 'true';
  const isAdmin            = status === 'Admin';
  const isFreeUnlimited    = status === 'Free unlimited access';

  authorized = isPriority || isAdmin || isFreeUnlimited;
}

// ── 3. Build denial message (used only when not authorized) ──
// The upstream router item is carried through the workflow via
// $('Extract Telegram Data').first().json
let chatId = null;
try {
  chatId = $('Extract Telegram Data').first().json.chatId;
} catch (_) {
  // If the node name differs, fall back to whatever is in scope
  chatId = item.json.chatId ?? null;
}

const denialBody = {
  chat_id: chatId,
  text: '⛔ У вас нет доступа к этому боту. Обратитесь к администратору.',
};

return [{
  json: {
    authorized,
    userRecord,
    chatId,
    denialBody,
  },
}];
