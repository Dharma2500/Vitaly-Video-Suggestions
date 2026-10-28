# Vitaly Video Suggestions

Telegram-бот **@vs_predlog_bot** и сайт для предложений зрителей. Заявки сначала попадают на модерацию и не появляются в публичной очереди без одобрения.

## Архитектура

- Папка docs: статический публичный сайт и админ-панель для Telegram Mini App.
- Файл src/index.js: Cloudflare Worker, Telegram webhook и API.
- Cloudflare D1: заявки, лимиты отправки и минимальный список банов.
- GitHub: исходный код. Секреты сюда не добавляются.

**Важно:** бот не скачивает и не открывает ссылки зрителей на сервере. Для YouTube-превью используется только стандартная картинка i.ytimg.com по проверенному ID ролика. Остальные поддерживаемые ссылки показываются без автоматически загружаемого превью. Это снижает риск SSRF и обработки вредоносных страниц.

## Защита

- Админ API проверяет подпись Telegram.WebApp.initData на сервере и сравнивает подтверждённый Telegram ID с ADMIN_TELEGRAM_ID. Проверка ID только в браузере не считается защитой.
- Telegram webhook проверяет секретный заголовок X-Telegram-Bot-Api-Secret-Token.
- Команды управления ботом разрешены только администратору. Бан и разбан выполняются по числовому Telegram ID, не по имени пользователя.
- При бане все заявки зрителя, его профиль и лимит отправки удаляются. В таблице банов остаётся Telegram ID и причина: эти минимальные данные нужны, чтобы отклонять новые заявки.
- На одного человека: 1 заявка в 60 секунд и максимум 5 за UTC-сутки. Повторная ссылка блокируется на 30 дней.
- Принимаются HTTPS-ссылки только с явно разрешённых видеосервисов либо обычный текст с названием фильма/видео. Список доменов находится в src/index.js.
- Пользовательский текст выводится на сайте как текст, а не HTML. Админ API не использует открытые CORS-запросы от неизвестных источников.
- Токен бота, webhook-секрет и другие приватные значения хранятся в Cloudflare Secrets, а не в файлах сайта.

Это защитные меры для MVP, а не гарантия абсолютной неуязвимости. После настройки следует включить уведомления Cloudflare и при публичном запуске добавить WAF rate-limit правило для API.

## Настройка с нуля

### 1. Получить Telegram ID администратора

Напиши боту @vs_predlog_bot команду /id. Он ответит твоим числовым Telegram ID. Ник и имя для администрирования не используются.

### 2. Подготовить Cloudflare Worker и D1

Установи Node.js LTS, скачай репозиторий и открой терминал в папке проекта:

~~~powershell
npm install --save-dev wrangler
npx wrangler login
npx wrangler d1 create vitaly-video-suggestions
~~~

Команда D1 покажет database_id. Вставь его в wrangler.toml вместо REPLACE_WITH_D1_DATABASE_ID. В том же файле замени REPLACE_WITH_YOUR_TELEGRAM_ID на ID из /id.

Создай таблицы:

~~~powershell
npx wrangler d1 execute vitaly-video-suggestions --remote --file=migrations/0001_init.sql
~~~

Добавь секреты командами. Каждый секрет вводится в приглашении терминала, не в исходный код:

~~~powershell
npx wrangler secret put BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
~~~

TELEGRAM_WEBHOOK_SECRET должен быть случайной строкой из латинских букв и цифр длиной 32-64 символа. Сохрани её локально: та же строка понадобится при регистрации webhook.

Опубликуй Worker:

~~~powershell
npx wrangler deploy
~~~

Скопируй выданный адрес вида https://vitaly-video-suggestions-api.ТВОЙ-АККАУНТ.workers.dev.

### 3. Настроить сайт и webhook

1. В docs/config.js укажи адрес своего Worker в API_BASE.
2. В wrangler.toml проверь PUBLIC_SITE_URL, ADMIN_APP_URL и ALLOWED_ORIGIN. Origin для GitHub Pages должен быть https://dharma2500.github.io без пути.
3. В GitHub открой **Settings → Pages** и выбери публикацию из ветки main, папка /docs.
4. Зарегистрируй Telegram webhook, заменив адрес Worker и значения локальными значениями токена/секрета. Не сохраняй эту команду с реальным токеном в репозитории или скриншотах.

Пример для PowerShell:

~~~powershell
$botToken = Read-Host "Вставь токен бота локально"
$webhookSecret = Read-Host "Вставь тот же TELEGRAM_WEBHOOK_SECRET"
$worker = Read-Host "Полный адрес Worker, например https://имя.аккаунт.workers.dev"
$body = @{
  url = "$worker/telegram/webhook"
  secret_token = $webhookSecret
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$botToken/setWebhook" -ContentType "application/json" -Body $body
Remove-Variable botToken, webhookSecret
~~~

Затем отправь боту /start, потом /admin. Команда /admin доступна только ID, указанному в ADMIN_TELEGRAM_ID. Кнопка откроет админ-панель внутри Telegram. Домен Web App при необходимости нужно привязать к боту через настройки @BotFather.

## Возможности админ-панели

- Просмотр всех заявок и поиск по названию, нику или числовому ID.
- Одобрение, отклонение, отметка «просмотрено» и удаление заявки.
- Бан пользователя прямо из его заявки или вручную по Telegram ID.
- Просмотр списка банов и разбан.
- Ни один ник пользователя не используется как ключ для действий.

## Ограничения и приватность

Публичная страница показывает только одобренные и просмотренные заявки. Баны очищают предложения из базы приложения, но не могут удалить то, что уже было скопировано или переслано Telegram вне этой системы. Таблица банов намеренно хранит ID, пока бан действует. Секреты и ID администратора не должны попадать в клиентский JavaScript; ID администратора Worker читает только из конфигурации.
