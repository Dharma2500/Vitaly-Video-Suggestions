(function () {
  "use strict";

  const statusEl = document.getElementById("public-status");
  const listEl = document.getElementById("public-suggestions");
  const emptyEl = document.getElementById("public-empty");
  const countEl = document.getElementById("suggestion-count");
  const refreshButton = document.getElementById("refresh-button");
  const apiBase = window.SUGGESTIONS_CONFIG && window.SUGGESTIONS_CONFIG.apiBase
    ? window.SUGGESTIONS_CONFIG.apiBase.replace(/\/+$/, "")
    : "";

  const allowedHosts = new Set([
    "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
    "twitch.tv", "www.twitch.tv", "clips.twitch.tv",
    "rutube.ru", "www.rutube.ru",
    "vk.com", "www.vk.com", "m.vk.com",
    "dzen.ru", "www.dzen.ru", "kinopoisk.ru", "www.kinopoisk.ru"
  ]);

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
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase()) ||
          url.username || url.password || url.port) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function formatDate(seconds) {
    const number = Number(seconds);
    if (!Number.isFinite(number) || number <= 0) return "";
    return new Date(number * 1000).toLocaleDateString("ru-RU", {
      day: "numeric", month: "short", year: "numeric"
    });
  }

  function createCard(item) {
    const card = document.createElement("article");
    card.className = "suggestion-card";

    const preview = document.createElement("div");
    preview.className = "card-preview";

    if (item.thumbnail_url) {
      try {
        const imageUrl = new URL(item.thumbnail_url);
        if (imageUrl.protocol === "https:" && imageUrl.hostname === "i.ytimg.com") {
          const image = document.createElement("img");
          image.src = imageUrl.href;
          image.alt = "Превью видео";
          image.loading = "lazy";
          image.referrerPolicy = "no-referrer";
          image.addEventListener("error", function () {
            image.remove();
            preview.classList.add("preview-placeholder");
            preview.textContent = "VS";
          }, { once: true });
          preview.appendChild(image);
        } else {
          preview.classList.add("preview-placeholder");
          preview.textContent = "VS";
        }
      } catch (_) {
        preview.classList.add("preview-placeholder");
        preview.textContent = "VS";
      }
    } else {
      preview.classList.add("preview-placeholder");
      preview.textContent = "VS";
    }
    card.appendChild(preview);

    const content = document.createElement("div");
    content.className = "card-content";
    const meta = document.createElement("div");
    meta.className = "card-meta";

    const source = document.createElement("span");
    source.className = "source-pill";
    source.textContent = String(item.source || "Предложение");
    meta.appendChild(source);

    const dateText = formatDate(item.created_at);
    if (dateText) {
      const date = document.createElement("span");
      date.className = "card-date";
      date.textContent = dateText;
      meta.appendChild(date);
    }
    content.appendChild(meta);

    const title = document.createElement("h3");
    title.textContent = String(item.title || "Без названия");
    content.appendChild(title);

    const safeUrl = safeExternalUrl(item.url);
    if (safeUrl) {
      const link = document.createElement("a");
      link.className = "card-link";
      link.href = safeUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
      link.textContent = "Открыть источник ↗";
      content.appendChild(link);
    } else {
      const note = document.createElement("span");
      note.className = "card-note";
      note.textContent = "Предложение зрителя";
      content.appendChild(note);
    }

    card.appendChild(content);
    return card;
  }

  async function loadSuggestions() {
    if (!apiBase || apiBase.includes("REPLACE_WITH_")) {
      statusEl.textContent = "API пока не подключён. После публикации Worker укажи его адрес в docs/config.js.";
      statusEl.className = "status-line status-error";
      countEl.textContent = "не подключено";
      emptyEl.hidden = true;
      return;
    }

    refreshButton.disabled = true;
    statusEl.textContent = "Обновляю очередь…";
    statusEl.className = "status-line";
    try {
      const response = await fetch(apiBase + "/api/public/suggestions", {
        method: "GET",
        headers: { "Accept": "application/json" },
        cache: "no-store",
        mode: "cors"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить очередь.");

      const items = Array.isArray(payload.suggestions) ? payload.suggestions : [];
      listEl.replaceChildren();
      items.forEach(function (item) {
        listEl.appendChild(createCard(item));
      });
      countEl.textContent = pluralize(items.length);
      emptyEl.hidden = items.length !== 0;
      statusEl.textContent = items.length
        ? "Показаны предложения, одобренные для публичной очереди."
        : "Одобренных предложений пока нет.";
      statusEl.className = "status-line";
    } catch (_) {
      statusEl.textContent = "Не удалось подключиться к очереди. Проверь адрес Worker, базу D1 и настройки CORS.";
      statusEl.className = "status-line status-error";
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", loadSuggestions);
  loadSuggestions();
})();
