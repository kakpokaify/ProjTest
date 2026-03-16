# Telegram Photo Tagger – n8n State Machine

A Telegram bot workflow for uploading up to 8 photos (individually or as an album) and tagging each one step-by-step. State is persisted in NocoDB.

---

## Architecture

The workflow is split into four logical pipelines:

```
Telegram Webhook
      │
      ▼
[Pipeline 1] Router & State Loader
      │  (loads/creates user in NocoDB, determines route)
      ├──► [Pipeline 2] Collector     (photo upload + album buffer)
      ├──► [Pipeline 3] Tagging Engine (text tag processing)
      └──► [Pipeline 4] Callback Handler (inline-button actions)
```

### NocoDB `users` table schema

| Field           | Type   | Description                                          |
|-----------------|--------|------------------------------------------------------|
| `tg_id`         | string | Telegram user ID (unique)                            |
| `state`         | string | `empty` \| `collecting` \| `tagging` \| `review` \| `editing_N` |
| `current_index` | number | Index of the photo currently being tagged            |
| `images`        | JSON   | `[{"file_id": "...", "tag": null}, ...]`             |

---

## Pipeline 1 – Router & State Loader

**Files:** `pipeline1_router.js`, `pipeline1_state_merge.js`

1. **Router Code Node** – Parses the Telegram Update:
   - Detects `message.text`, `message.photo`, `message.document`, or `callback_query`.
   - Extracts `chatId`, `userId`, `fileId`, `mediaGroupId`, `callbackData`, etc.

2. **NocoDB Find User** (HTTP GET) – Queries `users` by `tg_id`.

3. **NocoDB Create User** (HTTP POST) – Creates the record with `state=empty` if not found.

4. **State Merge Code Node** – Merges DB state into the item and computes `routeKey`:
   - `state == empty/collecting` + photo → `pipeline2`
   - `state == tagging/editing_N` + text → `pipeline3`
   - `callback_query` → `pipeline4`

5. **Route Switch** – Directs to the appropriate pipeline.

---

## Pipeline 2 – Collector

**Files:** `pipeline2_collector_aggregate.js`, `pipeline2_collector_patch_body.js`

1. **Wait 3 s** – Buffers all photos from a Telegram album (same `media_group_id`).

2. **Aggregate Code Node** – Collects unique `file_id` values from all buffered items, merges with existing `images` from DB, enforces 8-photo limit.

3. **NocoDB PATCH** – Writes `state=collecting` and updated `images` array.

4. **Telegram sendMessage** – Sends "Photos uploaded" with the **🏷 Assign Tags** inline button (`callback_data: start_tagging`).

---

## Pipeline 3 – Tagging Engine

**File:** `pipeline3_tagging.js`

1. **Tagging Code Node**:
   - Reads `images[currentIndex]` and writes the incoming text as `tag`.
   - If `state` is `editing_N`, writes to index `N` and returns to `review`.
   - Otherwise increments `current_index`:
     - More photos left → `state=tagging`, outputs `nextFileId` and `nextPhotoNumber`.
     - All photos tagged → `state=review`.

2. **NocoDB PATCH** – Persists updated `images` and new state.

3. **Tag Result Switch**:
   - `tagging` → `editMessageMedia` (show next photo with caption + Back/Cancel buttons).
   - `review` → **Build Review Report** → `sendMessage` with summary and edit keyboard.

### Telegram `editMessageMedia` body (next photo)

```json
{
  "chat_id": "{{ $json.chatId }}",
  "message_id": "{{ $json.messageId }}",
  "media": {
    "type": "photo",
    "media": "{{ $json.nextFileId }}",
    "caption": "Назначьте тег для фото №{{ $json.nextPhotoNumber }}"
  },
  "reply_markup": {
    "inline_keyboard": [[
      { "text": "◀ Назад",    "callback_data": "back"   },
      { "text": "✖ Отмена",  "callback_data": "cancel" }
    ]]
  }
}
```

---

## Pipeline 4 – UI / Callback Handler

**Files:** `pipeline4_callback.js`, `pipeline4_review_report.js`

### Handled `callback_data` values

| Value          | Action |
|----------------|--------|
| `cancel`       | Clear `images`, reset `state=empty`, call `deleteMessage` |
| `back`         | Decrement `current_index` (min 0), call `editMessageMedia` to previous photo |
| `start_tagging`| Set `state=tagging`, `current_index=0`, call `sendPhoto` with first image |
| `edit_N`       | Set `state=editing_N`, `current_index=N`, call `editMessageMedia` |
| `done`         | Reset state to `empty`, answer callback with confirmation |
| `show_review`  | Build and send the review report message |

### Review report format

```
Изображение 1 — [тег]
Изображение 2 — [тег]
...
```

With inline keyboard:
```
[✏️ Изменить фото 1]
[✏️ Изменить фото 2]
...
[✅ Готово]
```

---

## Environment Variables

| Variable               | Description                          |
|------------------------|--------------------------------------|
| `TELEGRAM_BOT_TOKEN`   | Bot token from @BotFather             |
| `NOCODB_BASE_URL`      | e.g. `https://app.nocodb.com`         |
| `NOCODB_PROJECT_ID`    | NocoDB project/base ID                |

Set these as **n8n environment variables** or use n8n credentials.

---

## Files

| File                                  | Purpose                                      |
|---------------------------------------|----------------------------------------------|
| `workflow.json`                        | Complete importable n8n workflow              |
| `pipeline1_router.js`                  | P1 Code Node – parse Telegram Update         |
| `pipeline1_state_merge.js`             | P1 Code Node – merge NocoDB state            |
| `pipeline2_collector_aggregate.js`     | P2 Code Node – aggregate album photos        |
| `pipeline2_collector_patch_body.js`    | P2 Code Node – prepare NocoDB PATCH body     |
| `pipeline3_tagging.js`                 | P3 Code Node – tag writing & index advance   |
| `pipeline4_callback.js`                | P4 Code Node – callback switch logic         |
| `pipeline4_review_report.js`           | P4 Code Node – build review report           |
| `telegram_bodies.json`                 | Reference Telegram API JSON bodies           |

## Import

1. Open n8n → **Workflows** → **Import from file**.
2. Select `workflows/workflow.json`.
3. Set the environment variables above.
4. Activate the workflow and register the webhook with Telegram:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_N8N_WEBHOOK_URL>
   ```
