const MAIN_REQ = "omid-ytfa-req";
const MAIN_RES = "omid-ytfa-res";

let faCues = [];
let settings = {
  fontSize: 24,
  bottom: 12,
  enabled: true
};

let lastVideoId = null;

function getVideoId() {
  const url = new URL(location.href);
  return url.searchParams.get("v") || "unknown-video";
}

function getWatchUrl() {
  const id = getVideoId();
  return id === "unknown-video" ? location.href : `https://www.youtube.com/watch?v=${id}`;
}

function getVideoTitle() {
  return (
    document.querySelector("h1 yt-formatted-string")?.textContent?.trim() ||
    document.querySelector("h1.title")?.textContent?.trim() ||
    document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim() ||
    "youtube-video"
  );
}

function safeFilename(name) {
  return String(name || "youtube-video")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function getVideoDuration() {
  const video = document.querySelector("video");
  return video && Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : null;
}

function requestMain(type, payload = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const reqId = `omid_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const onMessage = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.channel !== MAIN_RES || data.reqId !== reqId) return;

      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(data);
    };

    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, error: "ارتباط با bridge یوتیوب timeout شد. صفحه را Refresh کن." });
    }, timeoutMs);

    window.addEventListener("message", onMessage);
    window.postMessage({ channel: MAIN_REQ, type, reqId, ...payload }, "*");
  });
}

function injectOverlay() {
  const player =
    document.querySelector(".html5-video-player") ||
    document.querySelector("#movie_player") ||
    document.querySelector("ytd-player");

  if (!player) return null;

  let overlay = document.getElementById("omid-fa-subtitle-overlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "omid-fa-subtitle-overlay";
    overlay.textContent = "";
    player.appendChild(overlay);
  }

  player.classList.toggle("omid-fa-on", Boolean(settings.enabled && faCues.length));
  applySettings(settings);

  return overlay;
}

function applySettings(nextSettings) {
  settings = {
    fontSize: Number(nextSettings?.fontSize ?? settings.fontSize ?? 24),
    bottom: Number(nextSettings?.bottom ?? settings.bottom ?? 12),
    enabled: Boolean(nextSettings?.enabled ?? settings.enabled)
  };

  const overlay = document.getElementById("omid-fa-subtitle-overlay");
  const player = document.querySelector(".html5-video-player") || document.querySelector("#movie_player");

  if (overlay) {
    overlay.style.setProperty("--omid-fa-font-size", `${settings.fontSize}px`);
    overlay.style.setProperty("--omid-fa-bottom", `${settings.bottom}%`);
    overlay.classList.toggle("hidden", !settings.enabled);
  }

  if (player) {
    player.classList.toggle("omid-fa-on", Boolean(settings.enabled && faCues.length));
  }
}

function findActiveCue(time) {
  let left = 0;
  let right = faCues.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const cue = faCues[mid];

    if (time < cue.start) right = mid - 1;
    else if (time > cue.end) left = mid + 1;
    else return cue;
  }

  return null;
}

function renderLoop() {
  const currentId = getVideoId();

  if (currentId !== lastVideoId) {
    lastVideoId = currentId;
    loadStoredCues().catch(console.warn);
  }

  const video = document.querySelector("video");
  const overlay = injectOverlay();

  if (video && overlay) {
    if (!settings.enabled) {
      overlay.textContent = "";
    } else {
      const cue = findActiveCue(video.currentTime);
      overlay.textContent = cue ? cue.text : "";
    }
  }

  requestAnimationFrame(renderLoop);
}

renderLoop();

async function loadInitialSettings() {
  const result = await chrome.storage.local.get({
    omidFaSubtitleSettings: settings
  });

  applySettings(result.omidFaSubtitleSettings);
}

async function loadStoredCues() {
  const key = `omidFaSubs:${getVideoId()}`;
  const result = await chrome.storage.local.get(key);
  faCues = Array.isArray(result[key]) ? result[key] : [];
  applySettings(settings);
}

loadInitialSettings().catch(console.warn);
loadStoredCues().catch(console.warn);

function decodeHtml(text) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

function cleanText(text) {
  return decodeHtml(String(text || ""))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function secondsToTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds) * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function urlWithFormat(urlValue, fmt) {
  const url = new URL(urlValue);
  if (fmt) url.searchParams.set("fmt", fmt);
  return url.toString();
}

async function readCaptionText(url, fmt) {
  const finalUrl = fmt ? urlWithFormat(url, fmt) : url;

  const response = await fetch(finalUrl, {
    credentials: "include",
    cache: "no-store"
  });

  const text = await response.text();

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!text || !text.trim()) throw new Error("empty response");

  return text;
}

function parseJson3(text) {
  let data;

  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error("not json3");
  }

  const events = Array.isArray(data.events) ? data.events : [];
  const cues = [];
  let id = 1;

  for (const event of events) {
    if (!event.segs || event.tStartMs == null) continue;

    const source = cleanText(event.segs.map((seg) => seg.utf8 || "").join(""));
    if (!source) continue;

    const start = Number((Number(event.tStartMs) / 1000).toFixed(3));
    let duration = 2.5;

    if (event.dDurationMs != null && Number(event.dDurationMs) > 0) {
      duration = Number(event.dDurationMs) / 1000;
    }

    const end = Number((start + duration).toFixed(3));

    cues.push({
      id: id++,
      start,
      end,
      start_time: secondsToTimestamp(start),
      end_time: secondsToTimestamp(end),
      source,
      fa: ""
    });
  }

  if (!cues.length) throw new Error("json3 has no cues");
  return cues;
}

function parseXml(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "text/xml");

  if (xml.querySelector("parsererror")) throw new Error("not xml");

  const nodes = Array.from(xml.querySelectorAll("text, p"));
  const cues = [];
  let id = 1;

  for (const node of nodes) {
    const tag = node.tagName.toLowerCase();
    const startRaw = node.getAttribute("start") ?? node.getAttribute("t");
    const durRaw = node.getAttribute("dur") ?? node.getAttribute("d");

    if (startRaw == null) continue;

    let start = Number(startRaw);
    let duration = durRaw == null ? 2.5 : Number(durRaw);

    if (tag === "p" || start > 100000) {
      start = start / 1000;
      duration = duration / 1000;
    }

    if (!Number.isFinite(start)) continue;
    if (!Number.isFinite(duration) || duration <= 0) duration = 2.5;

    const source = cleanText(node.textContent || "");
    if (!source) continue;

    const end = Number((start + duration).toFixed(3));
    start = Number(start.toFixed(3));

    cues.push({
      id: id++,
      start,
      end,
      start_time: secondsToTimestamp(start),
      end_time: secondsToTimestamp(end),
      source,
      fa: ""
    });
  }

  if (!cues.length) throw new Error("xml has no cues");
  return cues;
}

function parseVttTimestamp(value) {
  const s = String(value || "").trim();
  const parts = s.split(":");

  let h = 0;
  let m = 0;
  let sec = 0;

  if (parts.length === 3) {
    h = Number(parts[0]);
    m = Number(parts[1]);
    sec = Number(parts[2].replace(",", "."));
  } else if (parts.length === 2) {
    m = Number(parts[0]);
    sec = Number(parts[1].replace(",", "."));
  } else {
    return NaN;
  }

  return h * 3600 + m * 60 + sec;
}

function parseVtt(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const cues = [];
  let id = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.includes("-->")) continue;

    const [left, rightRaw] = line.split("-->");
    const right = rightRaw.trim().split(/\s+/)[0];

    const start = parseVttTimestamp(left);
    const end = parseVttTimestamp(right);

    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const body = [];
    i++;

    while (i < lines.length && lines[i].trim()) {
      const item = lines[i].trim();
      if (!/^\d+$/.test(item)) body.push(item);
      i++;
    }

    const source = cleanText(body.join(" "));
    if (!source) continue;

    cues.push({
      id: id++,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      start_time: secondsToTimestamp(start),
      end_time: secondsToTimestamp(end),
      source,
      fa: ""
    });
  }

  if (!cues.length) throw new Error("vtt has no cues");
  return cues;
}

function fixCueTiming(cues) {
  cues.sort((a, b) => a.start - b.start);

  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].end > cues[i + 1].start) {
      cues[i].end = Number(cues[i + 1].start.toFixed(3));
      cues[i].end_time = secondsToTimestamp(cues[i].end);
    }
  }

  return cues;
}

async function readCuesFromUrl(captured) {
  const attempts = [
    { format: "json3-player-url", url: captured.json3Url || captured.originalUrl, fmt: null, parse: parseJson3 },
    { format: "json3", url: captured.originalUrl, fmt: "json3", parse: parseJson3 },
    { format: "srv3", url: captured.originalUrl, fmt: "srv3", parse: parseXml },
    { format: "xml", url: captured.originalUrl, fmt: null, parse: parseXml },
    { format: "vtt", url: captured.originalUrl, fmt: "vtt", parse: parseVtt }
  ];

  const errors = [];

  for (const attempt of attempts) {
    try {
      if (!attempt.url) throw new Error("missing url");
      const text = await readCaptionText(attempt.url, attempt.fmt);
      const cues = attempt.parse(text);
      return {
        cues: fixCueTiming(cues),
        format: attempt.format
      };
    } catch (err) {
      errors.push(`${attempt.format}: ${err.message}`);
    }
  }

  throw new Error(
    "متن زیرنویس قابل خواندن نبود.\n" +
    errors.slice(0, 5).join("\n")
  );
}

function buildModelPrompt() {
  return `این فایل JSON زیرنویس زمان‌دار YouTube است.

وظیفه تو:
برای هر آیتم داخل آرایه cues فقط فیلد fa را با ترجمه فارسی روان، طبیعی و مناسب زیرنویس پر کن.

قوانین خیلی مهم:
1. خروجی فقط JSON معتبر باشد.
2. هیچ توضیحی بیرون JSON ننویس.
3. schema، video، source_track و cues را حذف نکن.
4. مقدارهای id و start و end و start_time و end_time و source را اصلاً تغییر نده.
5. فقط fa را پر کن.
6. ترجمه باید کوتاه، قابل خواندن روی ویدیو و فارسی طبیعی باشد.
7. اگر جمله انگلیسی ناقص است، ترجمه را با توجه به قبل و بعد قابل فهم کن؛ اما زمان‌بندی را تغییر نده.
8. اگر متن شامل اصطلاح فنی است، فارسی روان بده و در صورت نیاز اصطلاح انگلیسی را داخل پرانتز نگه دار.
9. اگر cue فقط صدا، موسیقی یا عبارت بی‌معنی بود، fa را خالی نگذار؛ یک ترجمه کوتاه مناسب بنویس، مثل «[موسیقی]» یا «[تشویق]».

بعد از ترجمه، همان JSON کامل را برگردان.`;
}

function buildWorkfile(captured, cueResult) {
  const track = captured.track || {};

  return {
    schema: "omid-youtube-fa-subtitle-v1.1",
    video: {
      id: getVideoId(),
      title: getVideoTitle(),
      url: getWatchUrl(),
      duration_seconds: getVideoDuration()
    },
    source_track: {
      languageCode: track.languageCode || "",
      label: track.label || "",
      kind: track.kind || "manual",
      vssId: track.vssId || "",
      read_format: cueResult.format
    },
    generated_at: new Date().toISOString(),
    model_prompt: buildModelPrompt(),
    cues: cueResult.cues
  };
}

function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function makeWorkfile(trackIndex) {
  const captured = await requestMain("CAPTURE_CAPTION_URL", { trackIndex }, 16000);

  if (!captured?.ok) {
    throw new Error(captured?.error || "URL زیرنویس از YouTube player گرفته نشد.");
  }

  const cueResult = await readCuesFromUrl(captured);
  return buildWorkfile(captured, cueResult);
}

async function downloadWorkfileJson(trackIndex) {
  const workfile = await makeWorkfile(trackIndex);
  const filename = `${safeFilename(workfile.video.title)}-${workfile.source_track.languageCode || "captions"}-to-fa.json`;

  downloadText(filename, JSON.stringify(workfile, null, 2), "application/json;charset=utf-8");

  return {
    ok: true,
    count: workfile.cues.length,
    language: workfile.source_track.languageCode,
    format: workfile.source_track.read_format
  };
}

async function downloadPromptTxt(trackIndex) {
  const workfile = await makeWorkfile(trackIndex);
  const filename = `${safeFilename(workfile.video.title)}-prompt.txt`;

  const text =
`${buildModelPrompt()}

--------------------
JSON زیرنویس:
--------------------

${JSON.stringify(workfile, null, 2)}
`;

  downloadText(filename, text, "text/plain;charset=utf-8");

  return {
    ok: true,
    count: workfile.cues.length,
    language: workfile.source_track.languageCode,
    format: workfile.source_track.read_format
  };
}

function extractTranslatedCues(workfile) {
  if (!workfile || !Array.isArray(workfile.cues)) {
    throw new Error("فایل JSON معتبر نیست یا آرایه cues ندارد.");
  }

  const cues = [];

  for (const cue of workfile.cues) {
    const start = Number(cue.start);
    const end = Number(cue.end);
    const text = cleanText(cue.fa || "");

    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (!text) continue;

    cues.push({ start, end, text });
  }

  cues.sort((a, b) => a.start - b.start);

  if (!cues.length) {
    throw new Error("هیچ فیلد fa پرشده‌ای در فایل پیدا نشد.");
  }

  return cues;
}

async function loadTranslatedJson(workfile) {
  const cues = extractTranslatedCues(workfile);

  faCues = cues;

  const key = `omidFaSubs:${getVideoId()}`;
  await chrome.storage.local.set({ [key]: cues });

  injectOverlay();
  applySettings(settings);

  return {
    ok: true,
    count: cues.length
  };
}

async function clearSubs() {
  faCues = [];

  const key = `omidFaSubs:${getVideoId()}`;
  await chrome.storage.local.remove(key);

  const overlay = document.getElementById("omid-fa-subtitle-overlay");
  if (overlay) overlay.textContent = "";

  const player = document.querySelector(".html5-video-player") || document.querySelector("#movie_player");
  if (player) player.classList.remove("omid-fa-on");

  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "GET_CAPTION_TRACKS") {
        const res = await requestMain("GET_TRACKS", {}, 12000);

        if (!res?.ok) {
          sendResponse({ ok: false, error: res?.error || "ترک‌های زیرنویس پیدا نشدند." });
          return;
        }

        sendResponse({
          ok: true,
          tracks: res.tracks || [],
          preferredIndex: res.preferredIndex ?? 0
        });
        return;
      }

      if (message.type === "DOWNLOAD_WORKFILE_JSON") {
        sendResponse(await downloadWorkfileJson(message.trackIndex));
        return;
      }

      if (message.type === "DOWNLOAD_PROMPT_TXT") {
        sendResponse(await downloadPromptTxt(message.trackIndex));
        return;
      }

      if (message.type === "LOAD_TRANSLATED_JSON") {
        sendResponse(await loadTranslatedJson(message.workfile));
        return;
      }

      if (message.type === "CLEAR_SUBS") {
        sendResponse(await clearSubs());
        return;
      }

      if (message.type === "APPLY_SETTINGS") {
        applySettings(message.settings);
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "پیام ناشناخته است." });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});
