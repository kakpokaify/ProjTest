// ============================================================
// Pipeline 4 – UI / Callback Handler (Code Node)
// Processes inline-button callback_data and produces:
//   • nocoBody  – NocoDB PATCH payload (may be null)
//   • tgAction  – which Telegram method to call
//   • tgBody    – ready-to-send Telegram API JSON body
//   • routeKey  – drives downstream Switch node
// ============================================================

const item = $input.first();
const {
  callbackData,
  callbackQueryId,
  chatId,
  messageId,
  images,
  currentIndex,
  rowId,
} = item.json;

let nocoBody   = null;
let tgAction   = null;   // 'editMessageMedia' | 'deleteMessage' | 'sendMessage' | 'answerCallbackQuery'
let tgBody     = null;
let routeKey   = 'noop';
let newIndex   = currentIndex;

// ── Helper: build inline keyboard for tagging ────────────────

function tagKeyboard(idx, total) {
  const buttons = [];
  if (idx > 0) {
    buttons.push({ text: '◀ Назад', callback_data: 'back' });
  }
  buttons.push({ text: '✖ Отмена', callback_data: 'cancel' });
  return { inline_keyboard: [buttons] };
}

// ── Helper: build review message text + keyboard ─────────────

function buildReview(imgs) {
  const lines = imgs.map((img, i) =>
    `Изображение ${i + 1} — ${img.tag ?? '(без тега)'}`
  );
  const text = lines.join('\n');

  const editButtons = imgs.map((img, i) => [{
    text: `✏️ Изменить фото ${i + 1}`,
    callback_data: `edit_${i}`,
  }]);
  editButtons.push([{ text: '✅ Готово', callback_data: 'done' }]);

  return { text, keyboard: { inline_keyboard: editButtons } };
}

// ── Main switch ───────────────────────────────────────────────

if (callbackData === 'cancel') {
  // Clear all data, reset state
  nocoBody = {
    state: 'empty',
    images: JSON.stringify([]),
    current_index: 0,
  };
  tgAction = 'deleteMessage';
  tgBody   = { chat_id: chatId, message_id: messageId };
  routeKey = 'cancel';

} else if (callbackData === 'back') {
  newIndex = Math.max(0, currentIndex - 1);
  const prevFileId = images[newIndex]?.file_id ?? null;

  nocoBody = {
    state: 'tagging',
    current_index: newIndex,
  };

  tgAction = 'editMessageMedia';
  tgBody = {
    chat_id: chatId,
    message_id: messageId,
    media: {
      type: 'photo',
      media: prevFileId,
      caption: `Назначьте тег для фото №${newIndex + 1}`,
    },
    reply_markup: tagKeyboard(newIndex, images.length),
  };
  routeKey = 'back';

} else if (callbackData === 'start_tagging') {
  newIndex = 0;
  const firstFileId = images[0]?.file_id ?? null;

  nocoBody = {
    state: 'tagging',
    current_index: 0,
  };

  tgAction = 'sendPhoto';
  tgBody = {
    chat_id: chatId,
    photo: firstFileId,
    caption: `Назначьте тег для фото №1`,
    reply_markup: tagKeyboard(0, images.length),
  };
  routeKey = 'start_tagging';

} else if (callbackData === 'done') {
  // User confirmed the final review — just acknowledge
  nocoBody = { state: 'empty', images: JSON.stringify([]), current_index: 0 };
  tgAction = 'answerCallbackQuery';
  tgBody   = { callback_query_id: callbackQueryId, text: '✅ Теги сохранены!' };
  routeKey = 'done';

} else if (callbackData && callbackData.startsWith('edit_')) {
  const x = parseInt(callbackData.split('_')[1], 10);

  if (!Number.isNaN(x) && x >= 0 && x < images.length) {
    nocoBody = {
      state: `editing_${x}`,
      current_index: x,
    };

    tgAction = 'editMessageMedia';
    tgBody = {
      chat_id: chatId,
      message_id: messageId,
      media: {
        type: 'photo',
        media: images[x].file_id,
        caption: `Введите новый тег для фото №${x + 1}`,
      },
      reply_markup: tagKeyboard(x, images.length),
    };
    routeKey = 'edit';
  } else {
    routeKey = 'noop';
  }

} else if (callbackData === 'show_review') {
  // Triggered after all images have been tagged (state === 'review')
  const { text: reviewText, keyboard } = buildReview(images);

  tgAction = 'sendMessage';
  tgBody = {
    chat_id: chatId,
    text: reviewText,
    reply_markup: keyboard,
  };
  routeKey = 'show_review';
}

// ── Answer the callback query to remove the loading indicator ─
// (done as a separate HTTP call using answerCallbackQuery)
const answerCbBody = {
  callback_query_id: callbackQueryId,
};

return [{
  json: {
    ...item.json,
    nocoBody,
    tgAction,
    tgBody,
    answerCbBody,
    routeKey,
    newIndex,
  },
}];
