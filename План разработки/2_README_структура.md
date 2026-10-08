# 2. README: структура приложения

Статусы файлов: ✅ готов (работает, проверен `tsc --noEmit`) · 🟡 заглушка / частично (нужен код)

## Дерево проекта

```
nail-planner/
├── План разработки/
│   ├── 1_Промпты_и_ТЗ.md          # ТЗ-выжимка + промпты для нейронки
│   └── 2_README_структура.md      # этот файл
├── migrations/
│   └── 0001_init.sql              # ✅ таблицы users, appointments, day_notes
├── src/
│   ├── index.ts                   # ✅ точка входа: роуты, auth, cron, статика
│   ├── types.ts                   # ✅ типы и Env
│   ├── auth.ts                    # ✅ проверка подписи Telegram + middleware
│   ├── db.ts                      # 🟡 есть ensureUser/list/get/findConflicts, остальное TODO
│   ├── cron.ts                    # ✅ вечернее уведомление, защита от дублей
│   ├── api/
│   │   ├── appointments.ts        # ✅ CRUD + check + пересечения
│   │   ├── notes.ts               # ✅ заметки дня
│   │   ├── days.ts                # ✅ сводка для полосы недели (count, has_note)
│   │   ├── search.ts              # 🟡 заглушка (501)
│   │   ├── settings.ts            # 🟡 GET есть, PUT заглушка
│   │   └── export.ts              # 🟡 заглушка
│   ├── bot/
│   │   ├── telegram.ts            # ✅ клиент Bot API (sendMessage, кнопка Mini App)
│   │   └── webhook.ts             # ✅ /start /menu /today /tomorrow /id
│   └── lib/
│       ├── time.ts                # ✅ даты, часовые пояса, валидаторы
│       └── format.ts              # 🟡 формат расписания (сверить с ТЗ v2)
├── webapp/
│   ├── index.html                 # 🟡 заглушка
│   ├── style.css                  # 🟡 только палитра и база
│   └── app.js                     # 🟡 есть api() и даты, интерфейс TODO
├── wrangler.toml                  # ✅ конфиг Cloudflare (вписать database_id и APP_URL)
├── package.json  tsconfig.json    # ✅
├── .gitignore  .dev.vars.example  # ✅
└── README.md                      # ✅ запуск и деплой
```

## Что в каком файле должно быть

### Бэкенд

**`src/index.ts`**: создаёт Hono-приложение. `/webhook` без авторизации по подписи (там свой секрет), `/api/*` через `authMiddleware`, всё остальное отдаётся из `webapp/` через `ASSETS`. Экспортирует `fetch` и `scheduled` (cron).

**`src/auth.ts`**: `verifyInitData` (HMAC-SHA256 по токену бота, проверка `auth_date`), `parseAllowedIds` (максимум 2 ID), `authMiddleware` (403 для чужих, кладёт `userId` в контекст).

**`src/db.ts`**: все SQL-запросы. Каждый запрос фильтруется по `user_id`. Осталось дописать (см. промпт 4.1): insert/update/delete записей, заметки, поиск, настройки, сводка по дням.

**`src/api/appointments.ts`**:
- `GET /api/appointments?from&to`: записи за период
- `POST /api/appointments/check`: пересечения до сохранения
- `POST /api/appointments`: создать (ответ содержит `conflicts`, не блокирует)
- `PUT /api/appointments/:id`: изменить/перенести
- `DELETE /api/appointments/:id`

**`src/api/notes.ts`**: `GET/PUT /api/notes/:date` (пустой текст удаляет заметку).

**`src/api/days.ts`**: `GET /api/days?from&to` возвращает `[{date,count,has_note}]` для точек и значка 📝.

**`src/api/search.ts`**: `GET /api/search?q=` (поиск по части имени).

**`src/api/settings.ts`**: `GET/PUT /api/settings` (вкл/выкл уведомления, время, часовой пояс).

**`src/api/export.ts`**: CSV/JSON-выгрузка и отправка файла в чат ботом.

**`src/bot/webhook.ts`**: проверка `X-Telegram-Bot-Api-Secret-Token`, команды. Чужим бот молчит, `/id` отвечает всем (отключается `ENABLE_ID_COMMAND="false"`).

**`src/bot/telegram.ts`**: `tg()`, `sendMessage`, `openAppKeyboard` (кнопка только при https-адресе), `escapeHtml`.

**`src/cron.ts`**: раз в минуту для каждого разрешённого пользователя считает «вечернюю дату» (до 03:00 это вчера), если время пришло и `last_notified_date` не равна ей, отправляет расписание на завтра и записывает дату.

**`src/lib/time.ts`**: `nowInTz`, `addDays`, `isDate`, `isTime`, `weekdayRu`.

**`src/lib/format.ts`**: текст расписания для `/today`, `/tomorrow` и уведомления.

### Фронтенд

**`webapp/index.html`**: контейнер `#app`, экраны: неделя+день, форма, календарь, поиск, заметка, настройки.

**`webapp/style.css`**: пудрово-розовая палитра, переменные Telegram для светлой/тёмной темы, все компоненты.

**`webapp/app.js`**: `api()` (подпись в `X-Init-Data`), состояние, отрисовка экранов, свайп, форма, предупреждение о пересечении, перенос, удаление через `showConfirm`, заметки, календарь (1 января текущего года … сегодня + 3 года), поиск, настройки. Подробный список в TODO внутри файла.

## Данные (D1)

| Таблица | Поля |
|---|---|
| `users` | user_id (PK), tz, notify_enabled, notify_time, last_notified_date |
| `appointments` | id, user_id, date, start_time, end_time, client_name, who, service (`manicure`/`pedicure`/`both`), manicure_coating, pedicure_coating (`gel`/`none`), comment |
| `day_notes` | user_id + date (PK), text |

## Порядок заполнения (рекомендуемый)

1. `src/db.ts` → `src/api/search.ts`, `settings.ts`, `export.ts`
2. `src/lib/format.ts` (сверить с ТЗ)
3. `webapp/index.html` → `style.css` → `app.js`
4. Ревью (промпт 4.9) и проверка по чек-листу ниже

## Чек-лист проверки

1. `npm install` и `npm run typecheck` проходят без ошибок
2. `/id` в боте возвращает твой ID
3. `/start` присылает кнопку «Открыть ежедневник», приложение открывается
4. Чужой аккаунт: бот молчит, API отдаёт 403
5. Создание записи: все услуги и покрытия сохраняются, конец позже начала
6. При пересечении по времени показывается предупреждение, но запись сохраняется
7. Заметка дня: появляется значок 📝, пустой текст удаляет заметку
8. Уведомление приходит в заданное время один раз за вечер (проверить, поставив время на 2 минуты вперёд)
