// ============================================================
// Pipeline 3 – Tagging Engine (Code Node)
// Processes the user's text tag, writes it to the current
// image slot, advances the index, and decides next state.
// ============================================================

const item = $input.first();
const {
  text,
  images,
  currentIndex,
  userId,
  chatId,
  messageId,
  rowId,
} = item.json;

// ── 1. Write tag into the current slot ──────────────────────

// Guard: if the state was 'editing_X', override the target index
let targetIndex = currentIndex;
const userState = item.json.userState ?? 'tagging';
if (userState.startsWith('editing_')) {
  const x = parseInt(userState.split('_')[1], 10);
  if (!Number.isNaN(x) && x >= 0 && x < images.length) {
    targetIndex = x;
  }
}

const updatedImages = images.map((img, idx) =>
  idx === targetIndex ? { ...img, tag: text } : img
);

// ── 2. Advance index (only for normal tagging flow) ──────────

let newIndex = currentIndex;
let newState;
let nextFileId = null;
let nextPhotoNumber = null; // 1-based display number

if (userState.startsWith('editing_')) {
  // After editing a specific slot we return to review
  newState = 'review';
} else {
  newIndex = currentIndex + 1;
  if (newIndex < updatedImages.length) {
    newState  = 'tagging';
    nextFileId = updatedImages[newIndex].file_id;
    nextPhotoNumber = newIndex + 1; // 1-based
  } else {
    newState = 'review';
  }
}

// ── 3. NocoDB PATCH body ─────────────────────────────────────

const nocoBody = {
  state: newState,
  images: JSON.stringify(updatedImages),
  current_index: newIndex,
};

return [{
  json: {
    ...item.json,
    updatedImages,
    newIndex,
    newState,
    nextFileId,
    nextPhotoNumber,
    nocoBody,
    rowId,
  },
}];
