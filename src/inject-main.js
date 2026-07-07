/*
 * Runs in YouTube page MAIN world.
 *
 * This bridge reads YouTube player caption tracks and sends the selected
 * caption URL to the isolated extension script.
 */

(() => {
  const REQ = "omid-ytfa-req";
  const RES = "omid-ytfa-res";

  function getPlayer() {
    return document.getElementById("movie_player");
  }

  function getPlayerResponse() {
    const player = getPlayer();
    let response = null;

    try {
      if (player && typeof player.getPlayerResponse === "function") {
        response = player.getPlayerResponse();
      }
    } catch (_) {}

    return response || window.ytInitialPlayerResponse || null;
  }

  async function ensureCaptionsModule(player) {
    try {
      if (player && typeof player.loadModule === "function") {
        player.loadModule("captions");
      }
    } catch (_) {}

    await new Promise((resolve) => setTimeout(resolve, 450));
  }

  function labelFromTrack(track) {
    if (!track) return "";

    const name = track.name;

    if (typeof track.displayName === "string") return track.displayName;
    if (typeof track.languageName === "string") return track.languageName;
    if (typeof track.label === "string") return track.label;
    if (typeof name === "string") return name;
    if (name?.simpleText) return name.simpleText;
    if (Array.isArray(name?.runs)) return name.runs.map((r) => r.text).join("");

    return track.languageCode || track.lang || track.vssId || "Unknown";
  }

  function normalizeTrack(track, index, source) {
    return {
      index,
      source,
      label: labelFromTrack(track),
      languageCode: track?.languageCode || track?.lang || "",
      kind: track?.kind || "manual",
      vssId: track?.vssId || "",
      isDefault: Boolean(track?.isDefault)
    };
  }

  async function getTrackLists() {
    const player = getPlayer();
    const response = getPlayerResponse();
    const responseTracks =
      response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    let playerTracks = [];

    if (player) {
      await ensureCaptionsModule(player);

      try {
        playerTracks = player.getOption("captions", "tracklist") || [];
      } catch (_) {
        playerTracks = [];
      }
    }

    return { player, response, responseTracks, playerTracks };
  }

  function buildVisibleTracks(playerTracks, responseTracks) {
    const source = playerTracks.length ? "player" : "response";
    const list = playerTracks.length ? playerTracks : responseTracks;
    return list.map((track, index) => normalizeTrack(track, index, source));
  }

  function preferredIndex(tracks) {
    if (!tracks.length) return 0;

    const manualEnglish = tracks.find((t) => t.kind !== "asr" && (t.languageCode || "").startsWith("en"));
    const anyEnglish = tracks.find((t) => (t.languageCode || "").startsWith("en"));
    const manualAny = tracks.find((t) => t.kind !== "asr");

    return (manualEnglish || anyEnglish || manualAny || tracks[0]).index || 0;
  }

  function withFormat(value, fmt) {
    try {
      const url = new URL(String(value), location.origin);
      if (fmt) url.searchParams.set("fmt", fmt);
      return url.toString();
    } catch (_) {
      return null;
    }
  }

  async function getCaptionUrl(trackIndex) {
    const { response, responseTracks, playerTracks } = await getTrackLists();
    const visibleTracks = buildVisibleTracks(playerTracks, responseTracks);

    if (!visibleTracks.length) {
      return { ok: false, error: "این ویدیو زیرنویس قابل استخراج ندارد." };
    }

    const index = Number.isInteger(trackIndex) ? trackIndex : preferredIndex(visibleTracks);
    const sourceList = playerTracks.length ? playerTracks : responseTracks;
    const selectedTrack = sourceList[index] || sourceList[0];
    const url = selectedTrack?.baseUrl || selectedTrack?.url;

    if (!url) {
      return { ok: false, error: "URL زیرنویس برای این ترک پیدا نشد." };
    }

    const videoId =
      response?.videoDetails?.videoId ||
      new URL(location.href).searchParams.get("v") ||
      null;

    return {
      ok: true,
      videoId,
      originalUrl: url,
      json3Url: withFormat(url, "json3"),
      track: normalizeTrack(selectedTrack, index, playerTracks.length ? "player" : "response")
    };
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.channel !== REQ || !data.reqId) return;

    try {
      if (data.type === "GET_TRACKS") {
        const { response, responseTracks, playerTracks } = await getTrackLists();
        const tracks = buildVisibleTracks(playerTracks, responseTracks);

        window.postMessage({
          channel: RES,
          reqId: data.reqId,
          ok: true,
          videoId: response?.videoDetails?.videoId || null,
          tracks,
          preferredIndex: preferredIndex(tracks)
        }, "*");

        return;
      }

      if (data.type === "CAPTURE_CAPTION_URL") {
        const result = await getCaptionUrl(data.trackIndex);
        window.postMessage({
          channel: RES,
          reqId: data.reqId,
          ...result
        }, "*");

        return;
      }
    } catch (err) {
      window.postMessage({
        channel: RES,
        reqId: data.reqId,
        ok: false,
        error: err && err.message ? err.message : String(err)
      }, "*");
    }
  });
})();
