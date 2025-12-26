const BASE_URL = "https://www.justice.gov/epstein/files/";
const ALARM_NAME = "dataset_check_alarm";

const DEFAULTS = {
  enabled: true,
  nextIndex: 9,
  intervalMinutes: 5,

  // internal state
  isDownloading: false,
  currentDownloadId: null,

  // informational / UI
  lastFoundIndex: null,
  lastFoundAt: null,
  lastCheckedAt: null,
  lastCheckedUrl: null,
  lastStatus: null
};

function datasetUrl(n) {
  // justice.gov uses "DataSet 9.zip" etc. Space must be encoded.
  return `${BASE_URL}DataSet%20${n}.zip`;
}

async function getState() {
  const state = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...state };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

async function ensureAlarm(intervalMinutes) {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: intervalMinutes });
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title,
      message
    });
  } catch {
    // If icon missing or notification fails, ignore silently.
  }
}

// Try HEAD first; if server blocks it, use a tiny ranged GET.
// Returns: { exists: boolean, status: number|null }
async function urlExists(url) {
  // 1) HEAD
  try {
    const r = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store"
    });
    if (r.status === 200) return { exists: true, status: r.status };
    if (r.status === 404) return { exists: false, status: r.status };
    // fall through to ranged GET for other statuses
  } catch {
    // fall through
  }

  // 2) Ranged GET (0-0). 206 means it exists.
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { Range: "bytes=0-0" }
    });

    if (r.status === 200 || r.status === 206) return { exists: true, status: r.status };
    if (r.status === 404) return { exists: false, status: r.status };
    return { exists: false, status: r.status };
  } catch {
    return { exists: false, status: null };
  }
}

async function startDownloadFor(n) {
  const url = datasetUrl(n);

  await setState({
    isDownloading: true,
    lastFoundIndex: n,
    lastFoundAt: new Date().toISOString()
  });

  await notify("DataSet found", `Found DataSet ${n}.zip — starting download.`);

  const downloadId = await chrome.downloads.download({
    url,
    filename: `DataSet ${n}.zip`,
    conflictAction: "uniquify",
    saveAs: false
  });

  await setState({ currentDownloadId: downloadId });
}

async function checkOnce() {
  const state = await getState();
  if (!state.enabled) return;
  if (state.isDownloading) return;

  const n = Number(state.nextIndex);
  if (!Number.isFinite(n) || n < 1) {
    await setState({ nextIndex: 9 });
    return;
  }

  const url = datasetUrl(n);

  const { exists, status } = await urlExists(url);

  await setState({
    lastCheckedAt: new Date().toISOString(),
    lastCheckedUrl: url,
    lastStatus: status
  });

  if (exists) {
    await startDownloadFor(n);
  }
}

// When download completes, increment nextIndex and keep watching.
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta || !delta.id) return;

  const state = await getState();
  if (!state.currentDownloadId || delta.id !== state.currentDownloadId) return;

  if (delta.state && delta.state.current === "complete") {
    const finishedN = Number(state.nextIndex);

    await notify(
      "Download complete",
      `Downloaded DataSet ${finishedN}.zip. Now watching for DataSet ${finishedN + 1}.zip.`
    );

    await setState({
      isDownloading: false,
      currentDownloadId: null,
      nextIndex: finishedN + 1
    });

    // Immediately check next, in case multiple are already posted.
    checkOnce();
  }

  if (delta.state && delta.state.current === "interrupted") {
    await notify("Download interrupted", "Download was interrupted. Will keep checking.");
    await setState({ isDownloading: false, currentDownloadId: null });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await ensureAlarm(state.intervalMinutes);
  checkOnce();
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  await ensureAlarm(state.intervalMinutes);
});

// Alarm → check
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkOnce();
});

// Popup messaging
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "CHECK_NOW") {
      await checkOnce();
      sendResponse({ ok: true, state: await getState() });
      return;
    }

    if (msg?.type === "GET_STATE") {
      sendResponse({ ok: true, state: await getState() });
      return;
    }

    if (msg?.type === "SETTINGS") {
      const patch = {};

      if (typeof msg.enabled === "boolean") patch.enabled = msg.enabled;

      const nextIndex = Number(msg.nextIndex);
      if (Number.isFinite(nextIndex) && nextIndex >= 1) patch.nextIndex = nextIndex;

      const intervalMinutes = Number(msg.intervalMinutes);
      if (Number.isFinite(intervalMinutes) && intervalMinutes >= 1) {
        patch.intervalMinutes = intervalMinutes;
      }

      await setState(patch);

      const state = await getState();
      await ensureAlarm(state.intervalMinutes);

      sendResponse({ ok: true, state });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })();

  return true; // keep channel open
});
