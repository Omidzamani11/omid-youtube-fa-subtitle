const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const trackSelect = $("trackSelect");
const fontSize = $("fontSize");
const bottom = $("bottom");
const enabled = $("enabled");

function setStatus(text, error = false) {
  statusEl.style.color = error ? "#b00020" : "#0a6";
  statusEl.textContent = text;
}

async function getActiveYoutubeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.includes("youtube.com/watch")) {
    throw new Error("اول یک ویدیوی YouTube را باز کن.");
  }

  return tab;
}

async function sendToTab(message) {
  const tab = await getActiveYoutubeTab();

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (err) {
    throw new Error("افزونه روی این صفحه فعال نیست. صفحه YouTube را Refresh کن و دوباره امتحان کن.");
  }
}

async function loadTracks() {
  try {
    trackSelect.innerHTML = `<option value="">در حال خواندن...</option>`;
    const res = await sendToTab({ type: "GET_CAPTION_TRACKS" });

    if (!res?.ok) throw new Error(res?.error || "ترک زیرنویس پیدا نشد.");

    trackSelect.innerHTML = "";

    if (!res.tracks.length) {
      trackSelect.innerHTML = `<option value="">این ویدیو زیرنویس قابل استخراج ندارد</option>`;
      setStatus("این ویدیو زیرنویس قابل استخراج ندارد.", true);
      return;
    }

    for (const track of res.tracks) {
      const option = document.createElement("option");
      option.value = String(track.index);

      const kind = track.kind === "asr" ? "auto" : "manual";
      const label = track.label || track.languageCode || "Unknown";
      option.textContent = `${label} | ${track.languageCode || "?"} | ${kind}`;
      trackSelect.appendChild(option);
    }

    trackSelect.value = String(res.preferredIndex ?? 0);
    setStatus(`ترک‌ها آماده‌اند. تعداد: ${res.tracks.length}`);
  } catch (err) {
    setStatus(err.message, true);
    trackSelect.innerHTML = `<option value="">خطا در خواندن ترک‌ها</option>`;
  }
}

async function loadSettings() {
  const result = await chrome.storage.local.get({
    omidFaSubtitleSettings: {
      fontSize: 24,
      bottom: 12,
      enabled: true
    }
  });

  const settings = result.omidFaSubtitleSettings;
  fontSize.value = settings.fontSize;
  bottom.value = settings.bottom;
  enabled.checked = settings.enabled;

  $("fontSizeValue").textContent = settings.fontSize;
  $("bottomValue").textContent = settings.bottom;

  await sendToTab({ type: "APPLY_SETTINGS", settings }).catch(() => {});
}

async function saveAndApplySettings() {
  const settings = {
    fontSize: Number(fontSize.value),
    bottom: Number(bottom.value),
    enabled: Boolean(enabled.checked)
  };

  $("fontSizeValue").textContent = settings.fontSize;
  $("bottomValue").textContent = settings.bottom;

  await chrome.storage.local.set({ omidFaSubtitleSettings: settings });
  await sendToTab({ type: "APPLY_SETTINGS", settings }).catch(() => {});
}

$("refreshTracks").addEventListener("click", loadTracks);

$("downloadJson").addEventListener("click", async () => {
  try {
    const trackIndex = Number(trackSelect.value || 0);
    setStatus("در حال فعال‌کردن موقت caption و گرفتن URL واقعی...");
    const res = await sendToTab({ type: "DOWNLOAD_WORKFILE_JSON", trackIndex });

    if (!res?.ok) throw new Error(res?.error || "خروجی گرفتن ناموفق بود.");
    setStatus(`JSON دانلود شد.\ncue: ${res.count}\nزبان: ${res.language || "نامشخص"}\nفرمت: ${res.format || "?"}`);
  } catch (err) {
    setStatus(err.message, true);
  }
});

$("downloadPrompt").addEventListener("click", async () => {
  try {
    const trackIndex = Number(trackSelect.value || 0);
    setStatus("در حال ساخت پرامپت آماده...");
    const res = await sendToTab({ type: "DOWNLOAD_PROMPT_TXT", trackIndex });

    if (!res?.ok) throw new Error(res?.error || "ساخت پرامپت ناموفق بود.");
    setStatus(`پرامپت TXT دانلود شد.\ncue: ${res.count}\nفرمت: ${res.format || "?"}`);
  } catch (err) {
    setStatus(err.message, true);
  }
});

$("loadTranslated").addEventListener("click", async () => {
  try {
    const file = $("fileInput").files?.[0];
    if (!file) throw new Error("اول فایل JSON ترجمه‌شده را انتخاب کن.");

    const text = await file.text();

    if (!text.trim()) {
      throw new Error("فایل انتخابی خالی است.");
    }

    let workfile;
    try {
      workfile = JSON.parse(text);
    } catch (parseErr) {
      throw new Error("فایل JSON ناقص یا خراب است. خروجی مدل باید فقط JSON معتبر باشد.");
    }

    setStatus("در حال بارگذاری زیرنویس فارسی...");
    const res = await sendToTab({ type: "LOAD_TRANSLATED_JSON", workfile });

    if (!res?.ok) throw new Error(res?.error || "بارگذاری ناموفق بود.");
    setStatus(`زیرنویس فارسی فعال شد.\ncue فارسی: ${res.count}`);
  } catch (err) {
    setStatus(err.message, true);
  }
});

$("clearSubs").addEventListener("click", async () => {
  try {
    const res = await sendToTab({ type: "CLEAR_SUBS" });
    if (!res?.ok) throw new Error(res?.error || "پاک کردن ناموفق بود.");
    setStatus("زیرنویس این ویدیو پاک شد.");
  } catch (err) {
    setStatus(err.message, true);
  }
});

fontSize.addEventListener("input", saveAndApplySettings);
bottom.addEventListener("input", saveAndApplySettings);
enabled.addEventListener("change", saveAndApplySettings);

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await loadTracks();
});
