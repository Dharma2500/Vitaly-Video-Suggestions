import test from "node:test";
import assert from "node:assert/strict";
import { parseSuggestion } from "../src/index.js";

test("accepts a YouTube link and creates a safe thumbnail URL", () => {
  const result = parseSuggestion("Глянь этот ролик https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(result.ok, true);
  assert.equal(result.source, "YouTube");
  assert.equal(result.title, "Глянь этот ролик");
  assert.equal(result.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(result.thumbnailUrl, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
});

test("canonicalizes equivalent YouTube short links", () => {
  const result = parseSuggestion("https://youtu.be/dQw4w9WgXcQ?si=tracking");
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("accepts plain titles including Unicode and emoji", () => {
  const result = parseSuggestion("  Мой любимый фильм 🎬  ");
  assert.equal(result.ok, true);
  assert.equal(result.title, "Мой любимый фильм 🎬");
  assert.equal(result.url, null);
  assert.equal(result.thumbnailUrl, null);
});

test("accepts links from a supported non-YouTube service without server-fetching previews", () => {
  const result = parseSuggestion("https://clips.twitch.tv/example");
  assert.equal(result.ok, true);
  assert.equal(result.source, "Twitch");
  assert.equal(result.thumbnailUrl, null);
});

test("rejects arbitrary domains", () => {
  const result = parseSuggestion("https://evil.example/video");
  assert.equal(result.ok, false);
  assert.match(result.error, /домен пока не поддерживается/i);
});

test("rejects HTTP, ports and deceptive hosts", () => {
  assert.equal(parseSuggestion("http://youtube.com/watch?v=dQw4w9WgXcQ").ok, false);
  assert.equal(parseSuggestion("https://youtube.com:8443/watch?v=dQw4w9WgXcQ").ok, false);
  assert.equal(parseSuggestion("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ").ok, false);
});

test("rejects multiple links in one submission", () => {
  const result = parseSuggestion("Видео https://youtu.be/dQw4w9WgXcQ и https://twitch.tv/");
  assert.equal(result.ok, false);
  assert.match(result.error, /только одну ссылку/i);
});

test("rejects oversized titles", () => {
  const result = parseSuggestion("ф".repeat(301));
  assert.equal(result.ok, false);
  assert.match(result.error, /слишком длинное/i);
});

test("normalizes control characters and repeated whitespace", () => {
  const result = parseSuggestion("Фильм\u0000   на   вечер");
  assert.equal(result.ok, true);
  assert.equal(result.title, "Фильм на вечер");
});
