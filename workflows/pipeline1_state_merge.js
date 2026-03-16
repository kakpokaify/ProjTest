// ============================================================
// Pipeline 1 – State Merge (second Code Node)
// Runs AFTER the NocoDB HTTP "Find or Create User" step.
// Merges the DB record into the routing item and produces
// the final routeKey that the Switch node acts on.
// ============================================================

const items = $input.all();

// The first item carries router metadata; the NocoDB response
// is available via $('NocoDB Find User').first().json
const routerData = items[0].json;

// NocoDB returns { list: [...] } for GET /api/v1/db/data/noco/:id/:table
// When the user does not yet exist the list is empty and the Create
// branch will have already run, so we can safely fall back to defaults.
let dbUser = null;
try {
  const nocoResp = $('NocoDB Find User').first().json;
  if (nocoResp.list && nocoResp.list.length > 0) {
    dbUser = nocoResp.list[0];
  } else {
    // User was just created; pull from the Create response
    dbUser = $('NocoDB Create User').first().json;
  }
} catch (_) {
  dbUser = {};
}

const userState    = dbUser.state         ?? 'empty';
const currentIndex = dbUser.current_index ?? 0;
const images       = (() => {
  const raw = dbUser.images;
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (_) { return []; }
  }
  return Array.isArray(raw) ? raw : [];
})();

// ── Determine authoritative routeKey ────────────────────────
const { updateType } = routerData;

let routeKey = routerData.routeKey; // fallback

if (updateType === 'callback_query') {
  routeKey = 'pipeline4';
} else if (updateType === 'photo' &&
           (userState === 'empty' || userState === 'collecting')) {
  routeKey = 'pipeline2';
} else if (updateType === 'text' &&
           (userState === 'tagging' || userState.startsWith('editing_'))) {
  routeKey = 'pipeline3';
} else if (updateType === 'text' && userState === 'empty') {
  routeKey = 'idle'; // bot ignores unexpected text in empty state
} else {
  routeKey = 'unknown';
}

return [{
  json: {
    ...routerData,
    userState,
    currentIndex,
    images,
    rowId,
    routeKey,
  },
}];
