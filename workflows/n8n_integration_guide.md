# Руководство по интеграции: Telegram Photo Tagger в n8n

> **Язык:** Русский | **n8n:** v1.x | **NocoDB:** v0.x / v1.x

---

## Содержание

1. [Обзор архитектуры](#1-обзор-архитектуры)
2. [Предварительные требования](#2-предварительные-требования)
3. [Шаг 1 — Настройка NocoDB](#3-шаг-1--настройка-nocodb)
4. [Шаг 2 — Создание Telegram-бота](#4-шаг-2--создание-telegram-бота)
5. [Шаг 3 — Настройка переменных окружения в n8n](#5-шаг-3--настройка-переменных-окружения-в-n8n)
6. [Шаг 4 — Создание учётных данных в n8n](#6-шаг-4--создание-учётных-данных-в-n8n)
7. [Шаг 5 — Импорт workflow.json](#7-шаг-5--импорт-workflowjson)
8. [Шаг 6 — Подключение учётных данных к нодам](#8-шаг-6--подключение-учётных-данных-к-нодам)
9. [Шаг 7 — Активация воркфлоу и регистрация вебхука](#9-шаг-7--активация-воркфлоу-и-регистрация-вебхука)
10. [Описание пайплайнов и нод](#10-описание-пайплайнов-и-нод)
11. [Тестирование](#11-тестирование)
12. [Устранение неполадок](#12-устранение-неполадок)

---

## 1. Обзор архитектуры

```
Telegram Update (POST)
        │
        ▼
  [Webhook] ─────────────────────────────────────────────
        │
  [Extract Telegram Data]  ← Code Node: извлечь userId
        │
  [Auth: Find User]        ← HTTP GET /Users?where=(Telegram ID,eq,…)
        │
  [Pipeline 0: Auth Check] ← Code Node: Priority/Status
        │
  [Authorized?]  ──(нет)──► [TG: Access Denied] → СТОП
        │ (да)
  [Pipeline 1: Router]     ← Code Node: parse Update
        │
  [NocoDB Find User]       ← HTTP GET /users
        │
  [User Exists?] ──(нет)──► [NocoDB Create User]
        │ (да или после создания)
  [Pipeline 1: State Merge] ← Code Node: compute routeKey
        │
  [Route Switch] ──────────────────────────────────────┐
        │ pipeline2     │ pipeline3        │ pipeline4  │
        ▼               ▼                 ▼            │
  [Wait 3s]    [P3: Tagging Engine] [P4: Callback]    │
  [Aggregate]  [NocoDB PATCH–Tag]   [NocoDB PATCH–CB] │
  [NocoDB PATCH] [Tag Result Switch] [CB Route Switch] │
  [TG: Collected] │ tagging │ review  cancel/back/…   │
                  ▼         ▼                          │
            [TG: Next] [Build Review]◄─────────────────┘
                       [TG: Review]
```

**Всего нод:** 30  
**Таблицы NocoDB:** `Users` (авторизация), `users` (state machine)

---

## 2. Предварительные требования

| Компонент | Версия / Требование |
|-----------|----------------------|
| n8n | v1.0 или новее (self-hosted или облако) |
| NocoDB | v0.x / v1.x, публично доступный URL |
| Telegram Bot | Токен от @BotFather |
| HTTPS | n8n должен быть доступен по HTTPS (Telegram требует HTTPS для вебхуков) |

---

## 3. Шаг 1 — Настройка NocoDB

### 3.1 Таблица `Users` (авторизация)

Создайте таблицу `Users` (с заглавной U) со следующими полями:

| Название колонки | Тип | Описание |
|------------------|-----|----------|
| `Telegram ID` | Single line text | ID пользователя Telegram (строка) |
| `Priority` | Checkbox | `true` → доступ разрешён |
| `Status` | Single line text | `"Admin"` или `"Free unlimited access"` → доступ разрешён |

> **Важно:** Добавьте в таблицу записи для пользователей, которым нужен доступ, с заполненными `Telegram ID` и одним из разрешающих полей.

### 3.2 Таблица `users` (state machine)

Создайте таблицу `users` (строчная u) со следующими полями:

| Название колонки | Тип | Описание |
|------------------|-----|----------|
| `tg_id` | Single line text | ID пользователя Telegram (уникальный) |
| `state` | Single line text | `empty` / `collecting` / `tagging` / `review` / `editing_N` |
| `current_index` | Number | Индекс текущего фото при тегировании |
| `images` | Long text | JSON-массив: `[{"file_id":"…","tag":null}]` |

> **Совет:** Поле `images` должно быть типа **Long text** (не JSON), так как NocoDB хранит JSON как строку.

### 3.3 Получение API-ключа NocoDB

1. В NocoDB перейдите: **Team & Auth → API Tokens**.
2. Нажмите **+ Add new token**, задайте имя (например, `n8n-bot`).
3. Скопируйте токен — он понадобится в шаге 4.

### 3.4 Получение ID проекта (Base ID)

1. Откройте нужную базу в NocoDB.
2. В URL адресной строки найдите идентификатор: `https://app.nocodb.com/#/nc/<PROJECT_ID>/…`
3. Скопируйте `PROJECT_ID`.

---

## 4. Шаг 2 — Создание Telegram-бота

1. Напишите `@BotFather` в Telegram: `/newbot`.
2. Следуйте инструкциям, получите **токен** вида `123456789:AAF...`.
3. Сохраните токен — он понадобится в шаге 3.

> Убедитесь, что бот не добавлен в группы (или разрешите это явно).

---

## 5. Шаг 3 — Настройка переменных окружения в n8n

Переменные окружения задаются в `docker-compose.yml` (self-hosted) или в настройках облачного n8n.

### Self-hosted (docker-compose.yml / .env)

```yaml
environment:
  - N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom
  - TELEGRAM_BOT_TOKEN=123456789:AAF...
  - NOCODB_BASE_URL=https://app.nocodb.com
  - NOCODB_PROJECT_ID=your_project_id_here
```

### Облачный n8n (n8n.cloud)

1. Перейдите в **Settings → Environment variables**.
2. Добавьте три переменные:

| Ключ | Значение |
|------|----------|
| `TELEGRAM_BOT_TOKEN` | Токен от @BotFather |
| `NOCODB_BASE_URL` | URL вашего NocoDB, напр. `https://app.nocodb.com` |
| `NOCODB_PROJECT_ID` | ID проекта из п. 3.4 |

> После изменения env-переменных **перезапустите** n8n (или нажмите Save в облаке).

---

## 6. Шаг 4 — Создание учётных данных в n8n

Все HTTP-запросы к NocoDB используют заголовок авторизации `xc-token`.  
Нужно создать одни учётные данные типа **Header Auth**.

### 6.1 Создание Header Auth для NocoDB

1. В n8n перейдите: **Credentials → New Credential**.
2. Выберите тип **Header Auth**.
3. Заполните поля:
   - **Name:** `NocoDB API Key` (именно так — нода ищет по этому имени)
   - **Name (header name):** `xc-token`
   - **Value:** вставьте токен из п. 3.3
4. Нажмите **Save**.

> Этот же credential используется всеми 7 HTTP-нодами, обращающимися к NocoDB.

---

## 7. Шаг 5 — Импорт workflow.json

1. Откройте n8n в браузере.
2. Перейдите: **Workflows** (меню слева) → кнопка **⊕ New** → выберите **Import from File**.
3. Выберите файл `workflows/workflow.json` из этого репозитория.
4. Воркфлоу откроется в редакторе с именем **"Telegram Photo Tagger – State Machine"**.

> n8n может показать предупреждения о незаполненных учётных данных — это нормально, исправим в следующем шаге.

---

## 8. Шаг 6 — Подключение учётных данных к нодам

После импорта нужно подключить созданный credential **NocoDB API Key** ко всем HTTP-нодам, обращающимся к NocoDB (их 7).

### Список нод, требующих NocoDB credential

| Нода | Метод | Таблица |
|------|-------|---------|
| Auth: Find User | GET | Users |
| NocoDB Find User | GET | users |
| NocoDB Create User | POST | users |
| NocoDB PATCH – Collecting | PATCH | users |
| NocoDB PATCH – Tag | PATCH | users |
| NocoDB PATCH – Callback | PATCH | users |

### Как подключить

1. Дважды кликните на ноду (например, **Auth: Find User**).
2. В поле **Credential for Header Auth** выберите `NocoDB API Key` из выпадающего списка.
3. Нажмите **Save** (или закройте панель — n8n сохраняет автоматически).
4. Повторите для каждой ноды из списка выше.

> Telegram-ноды (sendMessage, editMessageMedia и т.д.) используют токен бота через переменную окружения `$env.TELEGRAM_BOT_TOKEN` в URL — они не требуют отдельного credential.

---

## 9. Шаг 7 — Активация воркфлоу и регистрация вебхука

### 9.1 Получение URL вебхука

1. В редакторе воркфлоу нажмите на ноду **Webhook** (первая нода).
2. В открывшейся панели скопируйте значение поля **Webhook URL**.  
   Оно выглядит примерно так:
   ```
   https://your-n8n.example.com/webhook/telegram-webhook
   ```

### 9.2 Активация воркфлоу

1. В правом верхнем углу редактора переключите тумблер **Active** в положение **ON**.
2. Дождитесь зелёного индикатора — воркфлоу активен и слушает входящие запросы.

### 9.3 Регистрация вебхука в Telegram

Откройте браузер или выполните запрос:

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<WEBHOOK_URL>
```

**Пример:**
```
https://api.telegram.org/bot123456789:AAF.../setWebhook?url=https://your-n8n.example.com/webhook/telegram-webhook
```

**Ожидаемый ответ Telegram:**
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

### 9.4 Проверка регистрации вебхука

```
https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

Убедитесь, что поле `url` содержит ваш URL и `pending_update_count` равен `0`.

---

## 10. Описание пайплайнов и нод

### Pipeline 0 — Авторизация (5 нод)

```
Webhook → Extract Telegram Data → Auth: Find User → P0: Auth Check → Authorized?
                                                                          │
                                                          (нет) → TG: Access Denied
```

| Нода | Тип | Что делает |
|------|-----|-----------|
| **Webhook** | Webhook | Принимает POST от Telegram. `responseMode: onReceived` — немедленно отвечает HTTP 200, воркфлоу продолжает работу в фоне |
| **Extract Telegram Data** | Code | Извлекает `chatId` и `userId` из `message` или `callback_query` |
| **Auth: Find User** | HTTP GET | `GET /Users?where=(Telegram ID,eq,{userId}}&limit=1` |
| **P0: Auth Check** | Code | Проверяет: `Priority === true` OR `Status === 'Admin'` OR `Status === 'Free unlimited access'`. Возвращает `{ authorized: true/false }` |
| **Authorized?** | IF | `true` → Pipeline 1; `false` → TG: Access Denied |
| **TG: Access Denied** | HTTP POST | `sendMessage` с текстом "⛔ У вас нет доступа…" |

---

### Pipeline 1 — Роутер и загрузка состояния (5 нод)

```
P0 ок → P1: Router → NocoDB Find User → [User Exists?] → (нет) NocoDB Create User
                                                ↓ (да или после создания)
                                         P1: State Merge → Route Switch
```

| Нода | Тип | Что делает |
|------|-----|-----------|
| **P1: Router** | Code | Разбирает Update: определяет тип (фото / текст / callback), извлекает `fileId`, `mediaGroupId`, `callbackData`, `messageId` |
| **NocoDB Find User** | HTTP GET | `GET /users?where=(tg_id,eq,{userId})` |
| **User Exists?** | IF | `list.length == 0` → создать пользователя |
| **NocoDB Create User** | HTTP POST | Создаёт запись `{tg_id, state: 'empty', current_index: 0, images: '[]'}` |
| **P1: State Merge** | Code | Объединяет данные Update и DB. Вычисляет `routeKey`: `pipeline2` (фото), `pipeline3` (текст + tagging), `pipeline4` (callback) |
| **Route Switch** | Switch | Направляет по `routeKey` в одну из трёх веток |

---

### Pipeline 2 — Сборщик фото (4 ноды)

```
Route Switch [pipeline2] → Wait 3s → P2: Aggregate → NocoDB PATCH–Collecting → TG: Photos Collected
```

| Нода | Тип | Что делает |
|------|-----|-----------|
| **Wait 3s** | Wait | Буферизует 3 секунды, чтобы собрать все фото из одного альбома (одинаковый `media_group_id`) |
| **P2: Aggregate** | Code | Собирает уникальные `file_id` из всех буферизованных элементов. Объединяет с существующим массивом `images`. Лимит: 8 фото |
| **NocoDB PATCH–Collecting** | HTTP PATCH | Записывает `state = 'collecting'`, обновлённый массив `images` |
| **TG: Photos Collected** | HTTP POST | `sendMessage`: "✅ Фото загружены" + кнопка **🏷 Назначить теги** (`callback_data: start_tagging`) |

---

### Pipeline 3 — Движок тегирования (5 нод)

```
Route Switch [pipeline3] → P3: Tagging Engine → NocoDB PATCH–Tag → Tag Result Switch
                                                                            │ tagging     │ review
                                                                     TG: Next Photo    Build Review Report
                                                                                          ↓
                                                                                       TG: Review
```

| Нода | Тип | Что делает |
|------|-----|-----------|
| **P3: Tagging Engine** | Code | Читает `images[current_index]`, записывает тег. Если `state = editing_N` — перезаписывает конкретный тег. Иначе сдвигает `current_index + 1`. Если массив не закончился → `newState = 'tagging'`; если закончился → `newState = 'review'` |
| **NocoDB PATCH–Tag** | HTTP PATCH | Сохраняет обновлённый `images` и `state` |
| **Tag Result Switch** | Switch | `tagging` → TG: Next Photo; `review` → Build Review Report |
| **TG: Next Photo** | HTTP POST | `editMessageMedia`: заменяет фото на `nextFileId` с подписью "Назначьте тег для фото №N" + кнопки ◀ Назад / ✖ Отмена |
| **Build Review Report** | Code | Формирует строку отчёта и клавиатуру: ✏️ Изменить фото 1…N + ✅ Готово |
| **TG: Review** | HTTP POST | `sendMessage` с текстом отчёта и inline-клавиатурой |

---

### Pipeline 4 — Обработчик callback-кнопок (7 нод)

```
Route Switch [pipeline4] → P4: Callback Handler → NocoDB PATCH–Callback → Callback Route Switch
                                                                                │
                           cancel      back/edit      start_tagging      done       show_review
                             │              │               │             │              │
                       TG: delete   TG: editMedia   TG: sendPhoto  TG: answerCB   Build Review
                             │              │               │
                       TG: answerCB  TG: answerCB   TG: answerCB
```

| Нода | Тип | Что делает |
|------|-----|-----------|
| **P4: Callback Handler** | Code | Switch по `callbackData`: `cancel` (сбросить), `back` (пред. фото), `start_tagging` (начать тегирование), `edit_N` (редактировать фото N), `done` (завершить), `show_review` (показать отчёт) |
| **NocoDB PATCH–Callback** | HTTP PATCH | Сохраняет изменённое состояние |
| **Callback Route Switch** | Switch | Направляет в нужную Telegram-ноду |
| **TG: deleteMessage** | HTTP POST | Удаляет сообщение (для `cancel`) |
| **TG: editMessageMedia (back/edit)** | HTTP POST | Заменяет фото (для `back` и `edit_N`) |
| **TG: sendPhoto (start_tagging)** | HTTP POST | Отправляет первое фото из массива |
| **TG: answerCallbackQuery (done)** | HTTP POST | Отвечает на callback с уведомлением "✅ Готово!" |
| **TG: answerCallbackQuery (ack)** | HTTP POST | Подтверждает остальные callback-и (пустой ответ) |

---

## 11. Тестирование

### 11.1 Быстрая проверка авторизации

1. Отправьте боту любое сообщение с Telegram-аккаунта, которого **нет** в таблице `Users`.
2. Бот должен ответить: "⛔ У вас нет доступа к этому боту."

3. Добавьте ваш `Telegram ID` в таблицу `Users` с `Priority = true`.
4. Отправьте любое сообщение — бот не ответит ошибкой (авторизация пройдена).

> Узнать свой Telegram ID: напишите боту `@userinfobot`.

### 11.2 Сценарий загрузки одного фото

1. Отправьте боту одно фото.
2. Через ~3 секунды бот ответит: "✅ Фото загружены" с кнопкой **🏷 Назначить теги**.
3. Нажмите кнопку.
4. Бот покажет фото с подписью "Назначьте тег для фото №1".
5. Введите любой текст — бот покажет отчёт.
6. Нажмите **✅ Готово**.

### 11.3 Сценарий загрузки альбома (2–8 фото)

1. Выберите 2–8 фото и отправьте их **одним сообщением** (альбомом) в Telegram.
2. Telegram отправит несколько обновлений с одинаковым `media_group_id` за ~1 сек.
3. Нода **Wait 3s** буферизует их; нода **Aggregate** собирает уникальные `file_id`.
4. Дальнейший сценарий аналогичен п. 11.2, но для каждого фото по очереди.

### 11.4 Проверка кнопки "Назад"

1. Пройдите тегирование до фото №2.
2. Нажмите **◀ Назад** — бот должен вернуться к фото №1.

### 11.5 Проверка отмены

1. В режиме тегирования нажмите **✖ Отмена**.
2. Сообщение должно удалиться, состояние в NocoDB — сброситься до `state = 'empty'`.

---

## 12. Устранение неполадок

### Webhook не срабатывает

- Проверьте, что n8n доступен по HTTPS (Telegram требует HTTPS).
- Проверьте регистрацию: `GET https://api.telegram.org/bot<TOKEN>/getWebhookInfo`.
- Убедитесь, что воркфлоу **активирован** (тумблер Active = ON).

### Ошибка 401 от NocoDB

- Убедитесь, что токен `xc-token` корректен и не истёк.
- Убедитесь, что credential **NocoDB API Key** подключён ко всем 6 NocoDB-нодам.

### NocoDB возвращает пустой `list` при запросе пользователя

- Проверьте, что имя колонки в таблице написано точно так же, как в запросе (`Telegram ID` — с пробелом, с заглавной буквы).
- Убедитесь, что `NOCODB_PROJECT_ID` соответствует вашей базе.

### Telegram не получает ответ на callback (кружок крутится)

- Нода **TG: answerCallbackQuery (ack)** должна выполняться после всех Telegram-нод в Pipeline 4.
- Убедитесь, что соединения от всех конечных нод ведут в **TG: answerCallbackQuery (ack)**.

### Фото не добавляются в массив (images остаётся пустым)

- В Pipeline 2, нода **P2: Aggregate** ожидает, что данные из предыдущих выполнений доступны через `$input.all()`.
- Убедитесь, что нода **Wait 3s** имеет параметр `resume: timeInterval`.

### Лимит 8 фото не срабатывает

- Нода **P2: Aggregate** вычисляет `Math.min(8, existingImages.length + newImages.length)` и обрезает массив. Проверьте поле `images` в таблице `users` в NocoDB.

### Ошибка "Cannot read properties of undefined"

- Обычно означает, что предыдущая нода не передала ожидаемые поля.
- Откройте вкладку **Executions** в n8n, найдите упавшее выполнение, нажмите на красную ноду — увидите входные и выходные данные.

---

## Быстрый чеклист запуска

- [ ] NocoDB: создана таблица `Users` с полями `Telegram ID`, `Priority`, `Status`
- [ ] NocoDB: создана таблица `users` с полями `tg_id`, `state`, `current_index`, `images`
- [ ] NocoDB: создан API-токен, получен Project ID
- [ ] Telegram: создан бот через @BotFather, получен токен
- [ ] n8n: добавлены env-переменные `TELEGRAM_BOT_TOKEN`, `NOCODB_BASE_URL`, `NOCODB_PROJECT_ID`
- [ ] n8n: создан credential **Header Auth** → `NocoDB API Key` (заголовок `xc-token`)
- [ ] n8n: импортирован `workflows/workflow.json`
- [ ] n8n: credential подключён к 6 NocoDB-нодам
- [ ] n8n: воркфлоу активирован (Active = ON)
- [ ] Telegram: вебхук зарегистрирован через `/setWebhook`
- [ ] Проверено: неавторизованный пользователь получает сообщение об отказе
- [ ] Проверено: полный сценарий загрузки фото и тегирования работает
