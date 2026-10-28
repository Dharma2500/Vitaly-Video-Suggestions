(function () {
  "use strict";

  const authStatus = document.getElementById("admin-auth-status");
  const panel = document.getElementById("admin-panel");
  const actionStatus = document.getElementById("admin-action-status");
  const suggestionList = document.getElementById("admin-suggestions");
  const suggestionCount = document.getElementById("admin-count");
  const suggestionEmpty = document.getElementById("admin-empty");
  const banList = document.getElementById("admin-bans");
  const bansEmpty = document.getElementById("bans-empty");
  const searchInput = document.getElementById("admin-search");
  const banForm = document.getElementById("ban-form");
  const banIdInput = document.getElementById("ban-id");
  const banReasonInput = document.getElementById("ban-reason");
  const refreshBansButton = document.getElementById("refresh-bans");

  const apiBase = window.SUGGESTIONS_CONFIG && window.SUGGESTIONS_CONFIG.apiBase
    ? window.SUGGESTIONS_CONFIG.apiBase.replace(/\/+$/, "")
    : "";
  const telegram = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  let initData = "";
  let allSuggestions = [];

  const statuses = [
    { value: "pending", label: "На проверке" },
    { value: "approved", label: "Одобрено" },
    { value: "rejected", label: "Отклонено" },
    { value: "seen", label: "Просмотрено" }
  ];

  function setActionStatus(message, isError) {
    actionStatus.textContent = message || "";
    actionStatus.className = "status-line small-status" + (isError ? " status-error" : "");
  }

  async function api(path, options) {
    if (!apiBase || apiBase.includes("REPLACE_WITH_")) {
      throw new Error("Сначала укажи адрес Worker в docs/config.js.");
    }
    const requestOptions = Object.assign({
      method: "GET",
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "Authorization": "tma " + initData
      }
    }, options || {});
    if (requestOptions.body) {
      requestOptions.headers = Object.assign({}, requestOptions.headers, {
        "Content-Type": "application/json"
      });
    }
    const response = await fetch(apiBase + path, requestOptions);
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      if (response.status === 401) throw new Error("Telegram не подтвердил доступ или авторизация устарела. Закрой панель и открой её снова через /admin.");
      throw new Error(payload.error || "Запрос не выполнен (" + response.status + ").");
    }
    return payload;
  }

  function formatDate(seconds) {
    const number = Number(seconds);
    if (!Number.isFinite(number) || number <= 0) return "дата неизвестна";
    return new Date(number * 1000).toLocaleString("ru-RU", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
    });
  }

  function statusLabel(value) {
    const found = statuses.find(function (status) { return status.value === value; });
    return found ? found.label : value;
  }

  function pluralize(count) {
    const n = Math.abs(count) % 100;
    const last = n % 10;
    if (n > 10 && n < 20) return count + " заявок";
    if (last > 1 && last < 5) return count + " заявки";
    if (last === 1) return count + " заявка";
    return count + " заявок";
  }

  function safeExternalUrl(value) {
    if (!value) return null;
    const allowed = new Set([
      "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
      "twitch.tv", "www.twitch.tv", "clips.twitch.tv",
      "rutube.ru", "www.rutube.ru", "vk.com", "www.vk.com", "m.vk.com",
      "dzen.ru", "www.dzen.ru", "kinopoisk.ru", "www.kinopoisk.ru"
    ]);
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !allowed.has(url.hostname.toLowerCase()) ||
          url.username || url.password || url.port) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function makeButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function renderSuggestion(item) {
    const card = document.createElement("article");
    card.className = "admin-card";

    const top = document.createElement("div");
    top.className = "admin-card-top";
    const badge = document.createElement("span");
    badge.className = "status-pill status-" + item.status;
    badge.textContent = statusLabel(item.status);
    top.appendChild(badge);

    const date = document.createElement("span");
    date.className = "card-date";
    date.textContent = formatDate(item.created_at);
    top.appendChild(date);
    card.appendChild(top);

    if (item.thumbnail_url) {
      try {
        const previewUrl = new URL(item.thumbnail_url);
        if (previewUrl.protocol === "https:" && previewUrl.hostname === "i.ytimg.com") {
          const preview = document.createElement("img");
          preview.className = "admin-thumb";
          preview.src = previewUrl.href;
          preview.alt = "Превью видео";
          preview.loading = "lazy";
          preview.referrerPolicy = "no-referrer";
          preview.addEventListener("error", function () { preview.remove(); }, { once: true });
          card.appendChild(preview);
        }
      } catch (_) {}
    }

    const title = document.createElement("h3");
    title.className = "admin-card-title";
    title.textContent = String(item.title || "Без названия");
    card.appendChild(title);

    const author = document.createElement("p");
    author.className = "admin-author";
    const displayName = [item.first_name, item.last_name].filter(Boolean).join(" ");
    const username = item.username ? " @" + String(item.username) : "";
    author.textContent = "Автор: " + (displayName || "имя не указано") + username +
      " · Telegram ID: " + String(item.telegram_id || "неизвестен");
    card.appendChild(author);

    const details = document.createElement("div");
    details.className = "admin-details";
    const source = document.createElement("span");
    source.className = "source-pill";
    source.textContent = String(item.source || "Текст");
    details.appendChild(source);
    const id = document.createElement("span");
    id.className = "mono-id";
    id.textContent = "Заявка " + String(item.id || "").slice(0, 8);
    details.appendChild(id);
    const safeUrl = safeExternalUrl(item.url);
    if (safeUrl) {
      const link = document.createElement("a");
      link.href = safeUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
      link.textContent = "Открыть источник ↗";
      link.className = "card-link";
      details.appendChild(link);
    }
    card.appendChild(details);

    const actions = document.createElement("div");
    actions.className = "admin-actions";

    const statusLabelEl = document.createElement("label");
    statusLabelEl.className = "status-control-label";
    statusLabelEl.textContent = "Статус";
    const select = document.createElement("select");
    select.className = "status-select";
    select.setAttribute("aria-label", "Статус заявки");
    statuses.forEach(function (entry) {
      const option = document.createElement("option");
      option.value = entry.value;
      option.textContent = entry.label;
      option.selected = entry.value === item.status;
      select.appendChild(option);
    });
    select.addEventListener("change", async function () {
      select.disabled = true;
      try {
        await api("/api/admin/suggestions/status", {
          method: "POST",
          body: JSON.stringify({ id: item.id, status: select.value })
        });
        setActionStatus("Статус заявки обновлён.", false);
        await loadSuggestions();
      } catch (error) {
        setActionStatus(error.message, true);
        select.value = item.status;
      } finally {
        select.disabled = false;
      }
    });
    statusLabelEl.appendChild(select);
    actions.appendChild(statusLabelEl);

    const banButton = makeButton("Забанить автора", "button button-danger button-small", async function () {
      const targetId = String(item.telegram_id || "");
      if (!/^\d{1,20}$/.test(targetId)) {
        setActionStatus("У заявки нет корректного Telegram ID автора.", true);
        return;
      }
      const reason = window.prompt("Причина бана. Все заявки этого пользователя будут удалены:", "Спам или неприемлемое содержание");
      if (reason === null) return;
      if (!window.confirm("Забанить Telegram ID " + targetId + " и удалить все его предложения?")) return;
      try {
        const result = await api("/api/admin/users/ban", {
          method: "POST",
          body: JSON.stringify({ telegram_id: targetId, reason: reason })
        });
        setActionStatus(result.message || "Пользователь забанен.", false);
        await Promise.all([loadSuggestions(), loadBans()]);
      } catch (error) {
        setActionStatus(error.message, true);
      }
    });
    actions.appendChild(banButton);

    const deleteButton = makeButton("Удалить заявку", "button button-secondary button-small", async function () {
      if (!window.confirm("Удалить только эту заявку? Бан пользователя не будет выполнен.")) return;
      try {
        await api("/api/admin/suggestions?id=" + encodeURIComponent(item.id), { method: "DELETE" });
        setActionStatus("Заявка удалена.", false);
        await loadSuggestions();
      } catch (error) {
        setActionStatus(error.message, true);
      }
    });
    actions.appendChild(deleteButton);
    card.appendChild(actions);
    return card;
  }

  function applySearch() {
    const query = String(searchInput.value || "").trim().toLocaleLowerCase("ru-RU");
    const filtered = allSuggestions.filter(function (item) {
      const value = [
        item.title, item.username, item.first_name, item.last_name, item.telegram_id, item.id, item.source
      ].join(" ").toLocaleLowerCase("ru-RU");
      return value.includes(query);
    });
    suggestionList.replaceChildren();
    filtered.forEach(function (item) { suggestionList.appendChild(renderSuggestion(item)); });
    suggestionCount.textContent = pluralize(filtered.length);
    suggestionEmpty.hidden = filtered.length !== 0;
    if (filtered.length === 0 && query) {
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = "По этому запросу ничего не найдено.";
      suggestionList.appendChild(note);
    }
  }

  async function loadSuggestions() {
    try {
      const result = await api("/api/admin/suggestions");
      allSuggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
      applySearch();
    } catch (error) {
      setActionStatus(error.message, true);
    }
  }

  async function loadBans() {
    try {
      const result = await api("/api/admin/bans");
      const bans = Array.isArray(result.bans) ? result.bans : [];
      banList.replaceChildren();
      bansEmpty.hidden = bans.length !== 0;
      bans.forEach(function (ban) {
        const row = document.createElement("article");
        row.className = "ban-row";

        const info = document.createElement("div");
        info.className = "ban-info";
        const id = document.createElement("strong");
        id.className = "mono-id";
        id.textContent = "Telegram ID: " + String(ban.telegram_id);
        info.appendChild(id);
        const reason = document.createElement("span");
        reason.textContent = String(ban.reason || "Причина не указана");
        info.appendChild(reason);
        const date = document.createElement("small");
        date.textContent = "Бан от " + formatDate(ban.banned_at);
        info.appendChild(date);
        row.appendChild(info);

        const unbanButton = makeButton("Разбанить", "button button-secondary button-small", async function () {
          if (!window.confirm("Разбанить Telegram ID " + String(ban.telegram_id) + "? Старые предложения не восстановятся.")) return;
          try {
            const response = await api("/api/admin/users/unban", {
              method: "POST",
              body: JSON.stringify({ telegram_id: String(ban.telegram_id) })
            });
            setActionStatus(response.message || "Пользователь разблокирован.", false);
            await loadBans();
          } catch (error) {
            setActionStatus(error.message, true);
          }
        });
        row.appendChild(unbanButton);
        banList.appendChild(row);
      });
    } catch (error) {
      setActionStatus(error.message, true);
    }
  }

  banForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const targetId = String(banIdInput.value || "").trim();
    const reason = String(banReasonInput.value || "").trim();
    if (!/^\d{1,20}$/.test(targetId)) {
      setActionStatus("Введи числовой Telegram ID, без @ника.", true);
      return;
    }
    if (!window.confirm("Забанить Telegram ID " + targetId + " и удалить все его заявки из системы?")) return;

    const submitButton = banForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const result = await api("/api/admin/users/ban", {
        method: "POST",
        body: JSON.stringify({ telegram_id: targetId, reason: reason })
      });
      setActionStatus(result.message || "Пользователь забанен.", false);
      banIdInput.value = "";
      banReasonInput.value = "";
      await Promise.all([loadSuggestions(), loadBans()]);
    } catch (error) {
      setActionStatus(error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  searchInput.addEventListener("input", applySearch);
  refreshBansButton.addEventListener("click", loadBans);

  if (!telegram || !telegram.initData) {
    authStatus.textContent = "Нет подтверждённой Telegram-сессии. Открой @vs_predlog_bot, отправь /admin и нажми кнопку панели.";
    authStatus.className = "status-line status-error";
    return;
  }

  telegram.ready();
  telegram.expand();
  initData = telegram.initData;

  api("/api/admin/suggestions")
    .then(async function (result) {
      allSuggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
      applySearch();
      panel.hidden = false;
      authStatus.textContent = "Доступ подтверждён Telegram.";
      authStatus.className = "status-line status-success";
      await loadBans();
    })
    .catch(function (error) {
      authStatus.textContent = error.message;
      authStatus.className = "status-line status-error";
    });
})();
