// ============================================================
// Pipeline 2 – Collector (Code Node B)
// Prepares the body for the NocoDB PATCH request that persists
// the merged images array and sets state = 'collecting'.
// The HTTP Request node uses {{ $json.nocoBody }} as its body.
// ============================================================

const item = $input.first();
const { mergedImages } = item.json;

const nocoBody = {
  state: 'collecting',
  images: JSON.stringify(mergedImages),
  current_index: 0,
};

// The NocoDB HTTP node needs the tg_id to build the WHERE filter,
// but the actual PATCH URL requires the NocoDB row Id.
// We expose both so the HTTP node can use expression syntax.
return [{
  json: {
    ...item.json,
    nocoBody,
    // rowId is fetched in the upstream "Find User" step and should
    // be available via $('NocoDB Find User').first().json.list[0].Id
    rowId: item.json.rowId ?? null,
  },
}];
