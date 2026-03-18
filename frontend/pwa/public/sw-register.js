if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // TEMP (dev): disable SW registration to avoid stale caching.
    // navigator.serviceWorker
    //   .register("/service-worker.js")
    //   .catch((err) => console.error("SW registration failed", err));
  });
}

let deferredPrompt;
const installBtn = document.getElementById("install-btn");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.hidden = false;
});

if (installBtn) installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

