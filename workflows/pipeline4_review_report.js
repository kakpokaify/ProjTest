// ============================================================
// Pipeline 4 – Review Report Generator (Code Node)
// Called when newState === 'review' from Pipeline 3.
// Builds the summary message text and the editing keyboard.
// ============================================================

const item = $input.first();
const { chatId } = item.json;

const images = Array.isArray(item.json.updatedImages)
  ? item.json.updatedImages
  : (Array.isArray(item.json.images) ? item.json.images : []);

// ── Build summary text ───────────────────────────────────────

const lines = images.map((img, i) =>
  `Изображение ${i + 1} — ${img.tag ?? '(без тега)'}`
);
const reviewText = lines.join('\n');

// ── Build inline keyboard with "Edit" buttons + "Done" ───────

const editButtons = images.map((img, i) => [{
  text: `✏️ Изменить фото ${i + 1}`,
  callback_data: `edit_${i}`,
}]);
editButtons.push([{ text: '✅ Готово', callback_data: 'done' }]);

const reviewKeyboard = { inline_keyboard: editButtons };

// ── Telegram sendMessage body ─────────────────────────────────

const tgBody = {
  chat_id: chatId,
  text: reviewText,
  reply_markup: reviewKeyboard,
};

return [{
  json: {
    ...item.json,
    reviewText,
    reviewKeyboard,
    tgBody,
    tgAction: 'sendMessage',
  },
}];
