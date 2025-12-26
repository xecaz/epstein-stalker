function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}

async function load() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!resp?.ok) return;

  const state = resp.state;

  document.getElementById("enabled").checked = !!state.enabled;
  document.getElementById("nextIndex").value = state.nextIndex ?? 9;
  document.getElementById("intervalMinutes").value = state.intervalMinutes ?? 5;

  const lastFoundEl = document.getElementById("lastFound");
  if (state.lastFoundIndex) {
    lastFoundEl.textContent = `DataSet ${state.lastFoundIndex}.zip (${fmtTime(state.lastFoundAt)})`;
  } else {
    lastFoundEl.textContent = "—";
  }

  document.getElementById("lastChecked").textContent = fmtTime(state.lastCheckedAt);
  document.getElementById("lastStatus").textContent =
    state.lastStatus === null || state.lastStatus === undefined ? "—" : String(state.lastStatus);

  const urlEl = document.getElementById("lastUrl");
  urlEl.textContent = state.lastCheckedUrl || "—";
  urlEl.title = state.lastCheckedUrl || "";
}

async function saveSettings() {
  const enabled = document.getElementById("enabled").checked;
  const nextIndex = Number(document.getElementById("nextIndex").value);
  const intervalMinutes = Number(document.getElementById("intervalMinutes").value);

  await chrome.runtime.sendMessage({
    type: "SETTINGS",
    enabled,
    nextIndex,
    intervalMinutes
  });
}

document.getElementById("save").addEventListener("click", async () => {
  await saveSettings();
  window.close();
});

document.getElementById("checkNow").addEventListener("click", async () => {
  await saveSettings();
  await chrome.runtime.sendMessage({ type: "CHECK_NOW" });
  window.close();
});

load();
