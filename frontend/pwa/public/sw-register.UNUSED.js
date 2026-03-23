// UNUSED FILE - NOT USED BY APP
// Service worker registration is disabled in index.html (script commented out).

window.addEventListener("DOMContentLoaded", () => {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      // TEMP (dev): disable SW registration to avoid stale caching.
      // navigator.serviceWorker
      //   .register("/service-worker.UNUSED.js")
      //   .catch((err) => console.error("SW registration failed", err));
    });

    // Disable service worker for development: unregister any previously installed SWs
    // This prevents SWs from being installed during development.
    navigator.serviceWorker.getRegistrations &&
      navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(regs.map((reg) => reg.unregister()))
          .then(() => {
            //console.log("Service Worker unregistered (dev)");
          })
          .catch((e) => {
            //console.warn("Service Worker unregister failed:", e);
          })
      );
  }

  let deferredPrompt;
  const installBtn = document.getElementById("install-btn");

  window.addEventListener("beforeinstallprompt", (e) => {
    // Prevent default install promotion in development
    e.preventDefault();
    deferredPrompt = null; // Block install
    if (installBtn) installBtn.hidden = true; // Hide install button
  });

  if (installBtn) installBtn.addEventListener("click", async () => {
    // Install is disabled in development
    // if (!deferredPrompt) return;
    // deferredPrompt.prompt();
    // await deferredPrompt.userChoice;
    // deferredPrompt = null;
    // installBtn.hidden = true;
  });
});
