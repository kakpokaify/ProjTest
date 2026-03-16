// ============================================================
// Pipeline 2 – Collector (Code Node A)
// Runs AFTER the 3-second Wait node.
// Aggregates all photo items that share the same mediaGroupId
// (album upload) or treats a single photo as a one-item album.
// Produces the merged images array ready for NocoDB PATCH.
// ============================================================

// All items buffered by the Wait node for this execution window
const items = $input.all();

// ── 1. Collect unique file_ids from all buffered photo items ─

const seenIds = new Set();
const newPhotos = [];

for (const it of items) {
  const fid = it.json.fileId;
  if (fid && !seenIds.has(fid)) {
    seenIds.add(fid);
    newPhotos.push({ file_id: fid, tag: null });
  }
}

// ── 2. Merge with the existing images array from NocoDB ──────

// The first item carries the full state (after pipeline1_state_merge)
const base = items[0].json;
const existing = Array.isArray(base.images) ? base.images : [];

// Combine, deduplicate, and enforce the 8-photo limit
const existingIds  = new Set(existing.map(p => p.file_id));
const toAdd        = newPhotos.filter(p => !existingIds.has(p.file_id));
const mergedImages = [...existing, ...toAdd].slice(0, 8);

// ── 3. Output ────────────────────────────────────────────────

return [{
  json: {
    ...base,
    mergedImages,
    newPhotoCount: toAdd.length,
    totalPhotos: mergedImages.length,
  },
}];
