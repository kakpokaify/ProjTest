// ============================================================
// Pipeline 1: Router & State Loader
// n8n Code Node – Entry point
// Receives a Telegram Update, parses the content type,
// loads (or creates) the user record from NocoDB, and
// outputs routing metadata so the Switch node can direct
// the item to the correct downstream pipeline.
// ============================================================

const item = $input.first();
const body = item.json.body ?? item.json;

// ── 1. Parse the incoming Telegram Update ───────────────────

let updateType = 'unknown';
let chatId     = null;
let userId     = null;
let text       = null;
let fileId     = null;
let mediaGroupId = null;
let messageId    = null;
let callbackQueryId = null;
let callbackData    = null;

if (body.message) {
  const msg = body.message;
  chatId      = msg.chat.id;
  userId      = String(msg.from.id);
  messageId   = msg.message_id;
  mediaGroupId = msg.media_group_id ?? null;

  if (msg.text) {
    updateType = 'text';
    text       = msg.text;
  } else if (msg.photo && msg.photo.length > 0) {
    // Telegram sends several resolutions; the last entry is the largest.
    updateType = 'photo';
    fileId     = msg.photo[msg.photo.length - 1].file_id;
  } else if (msg.document) {
    updateType = 'document';
    fileId     = msg.document.file_id;
  }
} else if (body.callback_query) {
  const cb = body.callback_query;
  chatId          = cb.message.chat.id;
  userId          = String(cb.from.id);
  messageId       = cb.message.message_id;
  callbackQueryId = cb.id;
  callbackData    = cb.data;
  updateType      = 'callback_query';
}

// ── 2. Validate: skip updates we cannot handle ──────────────

if (!userId) {
  return [{ json: { skip: true, reason: 'no_user_id' } }];
}

// ── 3. Output for downstream nodes ──────────────────────────
// The NocoDB "Find User" HTTP node uses {{ $json.userId }} in its
// query string. A Switch node then routes on routeKey.

const routeKey = (() => {
  // Actual routing depends on user state loaded from NocoDB.
  // Here we compute a preliminary key; the Switch node will use
  // the enriched output produced AFTER the NocoDB lookup merges
  // state into this item (see pipeline1_state_merge.js).
  if (updateType === 'callback_query') return 'callback';
  if (updateType === 'photo')          return 'photo';
  if (updateType === 'text')           return 'text';
  if (updateType === 'document')       return 'document';
  return 'unknown';
})();

return [{
  json: {
    updateType,
    chatId,
    userId,
    text,
    fileId,
    mediaGroupId,
    messageId,
    callbackQueryId,
    callbackData,
    routeKey,
  },
}];
