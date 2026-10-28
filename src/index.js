const encoder = new TextEncoder();

const ALLOWED_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "twitch.tv", "www.twitch.tv", "clips.twitch.tv",
  "rutube.ru", "www.rutube.ru",
  "vk.com", "www.vk.com", "m.vk.com",
  "dzen.ru", "www.dzen.ru",
  "kinopoisk.ru", "www.kinopoisk.ru"
]);
const VALID_STATUSES = new Set(["pending", "approved", "rejected", "seen"]);
const MAX_MESSAGE_LENGTH = 1200;
const MAX_TITLE_LENGTH = 300;
const MAX_DAILY_SUBMISSIONS = 5;
const MIN_SUBMISSION_INTERVAL = 60;
const DUPLICATE_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const ADMIN_INIT_DATA_MAX_AGE = 60 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }

      if (url.pathname === "/telegram/webhook" && request.method === "POST") {
        return await handleWebhook(request, env);
      }

      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, service: "vitaly-video-suggestions" }, 200, request, env);
      }

      if (url.pathname.startsWith("/api/admin/")) {
        const adminId = await authorizeAdmin(request, env);
        if (!adminId) return json({ error: "Admin authentication required" }, 401, request, env);
        return await handleAdminApi(request, url, env, adminId);
      }

      if (url.pathname === "/api/public/suggestions" && request.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT id, title, url, source, thumbnail_url, created_at, status " +
          "FROM suggestions WHERE status IN ('approved', 'seen') " +
          "ORDER BY created_at DESC LIMIT 100"
        ).all();
        return json({ suggestions: rows.results || [] }, 200, request, env);
      }

      return json({ error: "Not found" }, 404, request, env);
    } catch (error) {
      console.error("Request failed:", error && error.name ? error.name : "Error");
      return json({ error: "Internal server error" }, 500, request, env);
    }
  }
};

function corsHeaders(request, env) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Vary": "Origin"
  };
  const origin = request.headers.get("Origin");
  if (origin && env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(request, env)
  });
}

function cleanText(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function constantTimeStringEqual(left, right) {
  const a = encoder.encode(String(left || ""));
  const b = encoder.encode(String(right || ""));
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a[i] || 0) ^ (b[i] || 0);
  }
  return diff === 0;
}

async function handleWebhook(request, env) {
  const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!env.TELEGRAM_WEBHOOK_SECRET ||
      !constantTimeStringEqual(supplied, env.TELEGRAM_WEBHOOK_SECRET)) {
    return json({ error: "Unauthorized" }, 401, request, env);
  }
  if (!env.BOT_TOKEN || !env.DB) {
    return json({ error: "Service not configured" }, 503, request, env);
  }

  const update = await request.json();
  await processTelegramUpdate(update, env);
  return json({ ok: true }, 200, request, env);
}

async function telegramSend(env, chatId, text, extra) {
  if (!env.BOT_TOKEN || !chatId) return false;
  const payload = {
    chat_id: String(chatId),
    text: String(text || "").slice(0, 4096),
    link_preview_options: { is_disabled: true },
    ...(extra || {})
  };
  try {
    const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.warn("Telegram sendMessage returned HTTP", response.status);
      return false;
    }
    return true;
  } catch (_) {
    console.warn("Telegram sendMessage network error");
    return false;
  }
}

async function processTelegramUpdate(update, env) {
  const message = update && (update.message || update.edited_message);
  if (!message || !message.from || message.from.is_bot || !message.chat) return;
  if (message.chat.type !== "private") return;

  const userId = String(message.from.id);
  const text = typeof message.text === "string" ? message.text.trim() : "";

  if (text === "/id" || text === "/myid" || text.startsWith("/id@")) {
    await telegramSend(env, message.chat.id, "Твой Telegram ID: " + userId);
    return;
  }

  const command = text.match(/^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/i);
  if (command) {
    const name = command[1].toLowerCase();
    if (name === "start") {
      await telegramSend(
        env,
        message.chat.id,
        "Привет! Пришли ссылку на видео или просто название фильма/ролика. Заявка попадёт на модерацию, а после одобрения появится в публичной очереди.\n\nОграничение: 1 заявка в минуту, максимум 5 за сутки.\nКоманда /help покажет подсказку."
      );
      return;
    }
    if (name === "help") {
      await telegramSend(
        env,
        message.chat.id,
        "Отправь одним сообщением название фильма/ролика или ссылку на HTTPS-странице YouTube, Twitch, Rutube, VK, Дзена или Кинопоиска. Для ссылки можно дописать название перед ней.\n\nЗаявки сначала проверяются администратором. Не отправляй приватные данные и не присылай несколько ссылок в одном сообщении."
      );
      return;
    }
    if (name === "admin" || name === "ban" || name === "unban" || name === "bans") {
      if (userId !== String(env.ADMIN_TELEGRAM_ID || "")) {
        await telegramSend(env, message.chat.id, "Эта команда доступна только администратору.");
        return;
      }
      await handleAdminBotCommand(name, text, message, env, userId);
      return;
    }
    if (name === "id") {
      await telegramSend(env, message.chat.id, "Твой Telegram ID: " + userId);
      return;
    }
    await telegramSend(env, message.chat.id, "Не знаю такую команду. Напиши /help, чтобы посмотреть подсказку.");
    return;
  }

  const banned = await env.DB.prepare("SELECT telegram_id FROM bans WHERE telegram_id = ?1")
    .bind(userId).first();
  if (banned) {
    await telegramSend(env, message.chat.id, "Не могу принять заявку: доступ к предложениям ограничен.");
    return;
  }

  const parsed = parseSuggestion(text);
  if (!parsed.ok) {
    await telegramSend(env, message.chat.id, parsed.error);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (parsed.url) {
    const duplicate = await env.DB.prepare(
      "SELECT id FROM suggestions WHERE url = ?1 AND created_at >= ?2 LIMIT 1"
    ).bind(parsed.url, now - DUPLICATE_WINDOW_SECONDS).first();
    if (duplicate) {
      await telegramSend(env, message.chat.id, "Такая ссылка уже есть в системе. Повторно добавлять её не нужно.");
      return;
    }
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const limits = await env.DB.prepare(
    "SELECT last_submission_at, day_key, daily_count FROM user_limits WHERE telegram_id = ?1"
  ).bind(userId).first();

  if (limits && limits.day_key === dayKey && limits.daily_count >= MAX_DAILY_SUBMISSIONS) {
    await telegramSend(env, message.chat.id, "На сегодня лимит исчерпан: максимум 5 заявок за UTC-сутки. Попробуй завтра.");
    return;
  }
  if (limits && now - Number(limits.last_submission_at) < MIN_SUBMISSION_INTERVAL) {
    const wait = Math.max(1, MIN_SUBMISSION_INTERVAL - (now - Number(limits.last_submission_at)));
    await telegramSend(env, message.chat.id, "Слишком быстро. Подожди ещё " + wait + " сек. перед следующей заявкой.");
    return;
  }

  const reservation = await env.DB.prepare(
    "INSERT INTO user_limits (telegram_id, last_submission_at, day_key, daily_count) " +
    "VALUES (?1, ?2, ?3, 1) " +
    "ON CONFLICT(telegram_id) DO UPDATE SET " +
    "daily_count = CASE WHEN user_limits.day_key = excluded.day_key THEN user_limits.daily_count + 1 ELSE 1 END, " +
    "last_submission_at = excluded.last_submission_at, day_key = excluded.day_key " +
    "WHERE excluded.last_submission_at - user_limits.last_submission_at >= 60 " +
    "AND (user_limits.day_key != excluded.day_key OR user_limits.daily_count < 5) " +
    "RETURNING daily_count"
  ).bind(userId, now, dayKey).first();

  if (!reservation) {
    await telegramSend(env, message.chat.id, "Сработал лимит отправки. Подожди минуту и попробуй снова.");
    return;
  }

  const username = message.from.username ? String(message.from.username).slice(0, 64) : null;
  const firstName = cleanText(message.from.first_name || "").slice(0, 100) || null;
  const lastName = cleanText(message.from.last_name || "").slice(0, 100) || null;
  const suggestionId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (telegram_id, username, first_name, last_name, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username, " +
      "first_name = excluded.first_name, last_name = excluded.last_name"
    ).bind(userId, username, firstName, lastName, now),
    env.DB.prepare(
      "INSERT INTO suggestions (id, telegram_id, title, url, source, thumbnail_url, status, created_at, updated_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?7)"
    ).bind(suggestionId, userId, parsed.title, parsed.url, parsed.source, parsed.thumbnailUrl, now)
  ]);

  await telegramSend(env, message.chat.id, "Заявка принята и отправлена на модерацию. Спасибо!");
  const sender = (firstName || "Без имени") +
    (username ? " (@" + username + ")" : "");
  const notify = "Новая заявка на модерацию\n" +
    "ID заявки: " + suggestionId + "\n" +
    "Автор: " + sender + "\n" +
    "Telegram ID: " + userId + "\n" +
    "Источник: " + parsed.source + "\n" +
    "Название: " + parsed.title + "\n" +
    "Открой админ-панель командой /admin.";
  await telegramSend(env, env.ADMIN_TELEGRAM_ID, notify);
}

async function handleAdminBotCommand(name, text, message, env, adminId) {
  if (name === "admin") {
    if (!env.ADMIN_APP_URL || !env.ADMIN_APP_URL.startsWith("https://")) {
      await telegramSend(env, message.chat.id, "Админ-панель пока не настроена. Проверь ADMIN_APP_URL.");
      return;
    }
    await telegramSend(env, message.chat.id, "Панель модерации:", {
      reply_markup: {
        inline_keyboard: [[{
          text: "Открыть админ-панель",
          web_app: { url: env.ADMIN_APP_URL }
        }]]
      }
    });
    return;
  }

  if (name === "ban") {
    const match = text.match(/^\/ban(?:@\w+)?\s+(\d{1,20})(?:\s+([\s\S]+))?$/i);
    if (!match) {
      await telegramSend(env, message.chat.id, "Формат: /ban TELEGRAM_ID причина (причина необязательна). Используй числовой Telegram ID, не ник.");
      return;
    }
    const result = await banUser(env, adminId, match[1], cleanText(match[2] || "Блокировка администратором").slice(0, 250));
    await telegramSend(env, message.chat.id, result.message);
    return;
  }

  if (name === "unban") {
    const match = text.match(/^\/unban(?:@\w+)?\s+(\d{1,20})\s*$/i);
    if (!match) {
      await telegramSend(env, message.chat.id, "Формат: /unban TELEGRAM_ID");
      return;
    }
    const result = await unbanUser(env, adminId, match[1]);
    await telegramSend(env, message.chat.id, result.message);
    return;
  }

  if (name === "bans") {
    const result = await env.DB.prepare(
      "SELECT telegram_id, reason, banned_at FROM bans ORDER BY banned_at DESC LIMIT 30"
    ).all();
    const rows = result.results || [];
    if (!rows.length) {
      await telegramSend(env, message.chat.id, "Список банов пуст.");
      return;
    }
    const lines = rows.map(function (row) {
      return row.telegram_id + " | " + (row.reason || "без причины").slice(0, 120);
    });
    await telegramSend(env, message.chat.id, "Последние баны:\n" + lines.join("\n").slice(0, 3600));
  }
}

function parseSuggestion(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "Пришли название фильма/ролика или ссылку на поддерживаемый сервис." };
  }
  const text = cleanText(raw);
  if (!text) return { ok: false, error: "Сообщение пустое. Напиши название или пришли ссылку." };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: "Слишком длинное сообщение. Максимум 1200 символов." };
  }

  const matches = text.match(/https?:\/\/[^\s<>]+/giu) || [];
  if (matches.length > 1) {
    return { ok: false, error: "Отправь только одну ссылку за раз, чтобы заявки не превращались в свалку." };
  }

  let url = null;
  let source = "Текст";
  let thumbnailUrl = null;
  let title = text;

  if (matches.length === 1) {
    let candidate = matches[0].replace(/[.,!?]+$/g, "");
    let parsedUrl;
    try {
      parsedUrl = new URL(candidate);
    } catch (_) {
      return { ok: false, error: "Не удалось прочитать ссылку. Проверь её и отправь ещё раз." };
    }

    const host = parsedUrl.hostname.toLowerCase();
    if (parsedUrl.protocol !== "https:") {
      return { ok: false, error: "Принимаются только HTTPS-ссылки." };
    }
    if (parsedUrl.username || parsedUrl.password || parsedUrl.port) {
      return { ok: false, error: "Ссылка содержит недопустимые параметры. Отправь обычную HTTPS-ссылку." };
    }
    if (!ALLOWED_HOSTS.has(host)) {
      return { ok: false, error: "Этот домен пока не поддерживается. Разрешены YouTube, Twitch, Rutube, VK, Дзен и Кинопоиск. Можно отправить просто название." };
    }

    source = sourceName(host);
    url = canonicalizeUrl(parsedUrl);
    const rawTitle = text.replace(matches[0], "").trim();
    title = rawTitle.replace(/^[\s:|()[\]]+|[\s:|()[\]]+$/g, "") || source + " — ссылка от зрителя";
    const youtubeId = getYoutubeVideoId(parsedUrl);
    if (youtubeId) {
      thumbnailUrl = "https://i.ytimg.com/vi/" + youtubeId + "/hqdefault.jpg";
    }
  }

  title = cleanText(title);
  if (!title) return { ok: false, error: "Укажи название фильма/ролика или пришли ссылку." };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: "Название слишком длинное. Оставь до 300 символов и, если нужно, отправь ссылку отдельным сообщением." };
  }

  return { ok: true, title: title, url: url, source: source, thumbnailUrl: thumbnailUrl };
}

function sourceName(host) {
  if (host.includes("youtube") || host === "youtu.be") return "YouTube";
  if (host.includes("twitch.tv")) return "Twitch";
  if (host.includes("rutube.ru")) return "Rutube";
  if (host.includes("vk.com")) return "VK";
  if (host.includes("dzen.ru")) return "Дзен";
  if (host.includes("kinopoisk.ru")) return "Кинопоиск";
  return "Текст";
}

function getYoutubeVideoId(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase();
  let id = null;
  if (host === "youtu.be") {
    id = parsedUrl.pathname.split("/").filter(Boolean)[0] || null;
  } else if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
    id = parsedUrl.searchParams.get("v");
    if (!id) {
      const parts = parsedUrl.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && ["shorts", "embed", "live"].includes(parts[0])) id = parts[1];
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function canonicalizeUrl(parsedUrl) {
  const youtubeId = getYoutubeVideoId(parsedUrl);
  if (youtubeId) return "https://www.youtube.com/watch?v=" + youtubeId;

  parsedUrl.hash = "";
  const trackingParams = [];
  parsedUrl.searchParams.forEach(function (_, key) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || ["fbclid", "gclid", "si", "feature", "t", "ref", "ref_src"].includes(lower)) {
      trackingParams.push(key);
    }
  });
  trackingParams.forEach(function (key) { parsedUrl.searchParams.delete(key); });
  return parsedUrl.toString();
}

async function authorizeAdmin(request, env) {
  if (!env.BOT_TOKEN || !env.ADMIN_TELEGRAM_ID) return null;
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^tma\s+(.+)$/i);
  if (!match || match[1].length > 8192) return null;

  try {
    const params = new URLSearchParams(match[1]);
    if (params.getAll("hash").length !== 1 || params.getAll("user").length !== 1) return null;
    const suppliedHash = params.get("hash") || "";
    if (!/^[0-9a-f]{64}$/i.test(suppliedHash)) return null;

    const authDate = Number(params.get("auth_date"));
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(authDate) || authDate > now + 300 || now - authDate > ADMIN_INIT_DATA_MAX_AGE) return null;

    const entries = [];
    const seenKeys = new Set();
    for (const [key, value] of params.entries()) {
      if (key === "hash") continue;
      if (seenKeys.has(key)) return null;
      seenKeys.add(key);
      entries.push([key, value]);
    }
    entries.sort(function (a, b) { return a[0].localeCompare(b[0]); });
    const checkString = entries.map(function (pair) { return pair[0] + "=" + pair[1]; }).join("\n");

    const tokenKey = await crypto.subtle.importKey(
      "raw", encoder.encode(env.BOT_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const secretKeyBytes = new Uint8Array(await crypto.subtle.sign("HMAC", tokenKey, encoder.encode("WebAppData")));
    const secretKey = await crypto.subtle.importKey(
      "raw", secretKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const calculated = bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", secretKey, encoder.encode(checkString))));
    if (!constantTimeStringEqual(calculated.toLowerCase(), suppliedHash.toLowerCase())) return null;

    const user = JSON.parse(params.get("user") || "null");
    if (!user || !/^\d{1,20}$/.test(String(user.id || ""))) return null;
    if (String(user.id) !== String(env.ADMIN_TELEGRAM_ID).trim()) return null;
    return String(user.id);
  } catch (_) {
    return null;
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

async function handleAdminApi(request, url, env, adminId) {
  const path = url.pathname;

  if (path === "/api/admin/suggestions" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT s.id, s.telegram_id, s.title, s.url, s.source, s.thumbnail_url, s.status, s.created_at, " +
      "u.username, u.first_name, u.last_name " +
      "FROM suggestions s LEFT JOIN users u ON u.telegram_id = s.telegram_id " +
      "ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 500"
    ).all();
    return json({ suggestions: result.results || [] }, 200, request, env);
  }

  if (path === "/api/admin/bans" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT telegram_id, reason, banned_at, banned_by FROM bans ORDER BY banned_at DESC LIMIT 500"
    ).all();
    return json({ bans: result.results || [] }, 200, request, env);
  }

  if (path === "/api/admin/users/ban" && request.method === "POST") {
    const body = await readSmallJson(request);
    if (!body) return json({ error: "Invalid JSON body" }, 400, request, env);
    const targetId = String(body.telegram_id || "").trim();
    if (!/^\d{1,20}$/.test(targetId)) {
      return json({ error: "Нужен числовой Telegram ID (до 20 цифр)." }, 400, request, env);
    }
    const reason = cleanText(body.reason || "Блокировка администратором").slice(0, 250);
    const result = await banUser(env, adminId, targetId, reason);
    if (!result.ok) return json({ error: result.message }, 400, request, env);
    return json({ ok: true, deleted_suggestions: result.deletedSuggestions, message: result.message }, 200, request, env);
  }

  if (path === "/api/admin/users/unban" && request.method === "POST") {
    const body = await readSmallJson(request);
    if (!body) return json({ error: "Invalid JSON body" }, 400, request, env);
    const targetId = String(body.telegram_id || "").trim();
    if (!/^\d{1,20}$/.test(targetId)) {
      return json({ error: "Нужен числовой Telegram ID (до 20 цифр)." }, 400, request, env);
    }
    const result = await unbanUser(env, adminId, targetId);
    return json({ ok: true, message: result.message }, 200, request, env);
  }

  if (path === "/api/admin/suggestions/status" && request.method === "POST") {
    const body = await readSmallJson(request);
    if (!body) return json({ error: "Invalid JSON body" }, 400, request, env);
    const id = String(body.id || "");
    const status = String(body.status || "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !VALID_STATUSES.has(status)) {
      return json({ error: "Invalid suggestion ID or status" }, 400, request, env);
    }
    const row = await env.DB.prepare("SELECT telegram_id FROM suggestions WHERE id = ?1").bind(id).first();
    if (!row) return json({ error: "Заявка не найдена." }, 404, request, env);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("UPDATE suggestions SET status = ?1, updated_at = ?2 WHERE id = ?3").bind(status, now, id),
      env.DB.prepare(
        "INSERT INTO admin_audit (admin_telegram_id, action, target_telegram_id, suggestion_id, details, created_at) " +
        "VALUES (?1, 'set_status', ?2, ?3, ?4, ?5)"
      ).bind(adminId, row.telegram_id, id, status, now)
    ]);
    return json({ ok: true }, 200, request, env);
  }

  if (path === "/api/admin/suggestions" && request.method === "DELETE") {
    const id = String(url.searchParams.get("id") || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid suggestion ID" }, 400, request, env);
    const row = await env.DB.prepare("SELECT telegram_id FROM suggestions WHERE id = ?1").bind(id).first();
    if (!row) return json({ error: "Заявка не найдена." }, 404, request, env);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM suggestions WHERE id = ?1").bind(id),
      env.DB.prepare(
        "INSERT INTO admin_audit (admin_telegram_id, action, target_telegram_id, suggestion_id, details, created_at) " +
        "VALUES (?1, 'delete_suggestion', ?2, ?3, '', ?4)"
      ).bind(adminId, row.telegram_id, id, now)
    ]);
    return json({ ok: true }, 200, request, env);
  }

  return json({ error: "Not found" }, 404, request, env);
}

async function readSmallJson(request) {
  const sizeHeader = Number(request.headers.get("Content-Length") || 0);
  if (sizeHeader > 4096) return null;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body;
  } catch (_) {
    return null;
  }
}

async function banUser(env, adminId, targetId, reason) {
  if (!/^\d{1,20}$/.test(String(targetId))) {
    return { ok: false, message: "Нужен числовой Telegram ID." };
  }
  if (String(targetId) === String(env.ADMIN_TELEGRAM_ID)) {
    return { ok: false, message: "Нельзя забанить администратора." };
  }

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS amount FROM suggestions WHERE telegram_id = ?1"
  ).bind(targetId).first();
  const deletedSuggestions = Number(countRow && countRow.amount ? countRow.amount : 0);
  const now = Math.floor(Date.now() / 1000);
  const safeReason = cleanText(reason || "Блокировка администратором").slice(0, 250);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR REPLACE INTO bans (telegram_id, reason, banned_at, banned_by) VALUES (?1, ?2, ?3, ?4)"
    ).bind(targetId, safeReason, now, adminId),
    env.DB.prepare("DELETE FROM suggestions WHERE telegram_id = ?1").bind(targetId),
    env.DB.prepare("DELETE FROM users WHERE telegram_id = ?1").bind(targetId),
    env.DB.prepare("DELETE FROM user_limits WHERE telegram_id = ?1").bind(targetId),
    env.DB.prepare(
      "INSERT INTO admin_audit (admin_telegram_id, action, target_telegram_id, details, created_at) " +
      "VALUES (?1, 'ban', ?2, ?3, ?4)"
    ).bind(adminId, targetId, "reason=" + safeReason + ";deleted_suggestions=" + deletedSuggestions, now)
  ]);

  return {
    ok: true,
    deletedSuggestions: deletedSuggestions,
    message: "ID " + targetId + " забанен. Удалено заявок: " + deletedSuggestions + "."
  };
}

async function unbanUser(env, adminId, targetId) {
  if (!/^\d{1,20}$/.test(String(targetId))) {
    return { ok: false, message: "Нужен числовой Telegram ID." };
  }
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM bans WHERE telegram_id = ?1").bind(targetId),
    env.DB.prepare(
      "INSERT INTO admin_audit (admin_telegram_id, action, target_telegram_id, details, created_at) " +
      "VALUES (?1, 'unban', ?2, '', ?3)"
    ).bind(adminId, targetId, now)
  ]);
  return { ok: true, message: "ID " + targetId + " разблокирован." };
}
