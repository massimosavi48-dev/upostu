import { connectWebSocket, sendMessage } from "./ws.js";

console.log("MAIN JS LOADED (module)");

window.addEventListener("DOMContentLoaded", () => {
  console.log("DOMContentLoaded - init frontend");

  // ==============================
  // CONNESSIONE WEBSOCKET
  // ==============================
  try {
    connectWebSocket();
    console.log("WebSocket init requested");
  } catch (e) {
    console.error("WebSocket init failed:", e);
  }

  // ==============================
  // MAPPA
  // ==============================
  const mapEl = document.getElementById("map");
  if (!mapEl) {
    console.warn('Elemento "#map" non trovato: salto init mappa');
    return;
  }
  if (typeof window.L === "undefined") {
    console.error("Leaflet (L) non caricato: controlla gli script in index.html");
    return;
  }

  const map = L.map(mapEl, {
    zoomControl: true,
    preferCanvas: true,
  }).setView([38.1157, 13.3615], 13);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const fixMapSize = () => {
    try {
      map.invalidateSize();
      console.log("map.invalidateSize()");
    } catch (e) {
      console.warn("map.invalidateSize() failed:", e);
    }
  };

  // Mobile: spesso il container cambia dimensione dopo paint
  requestAnimationFrame(fixMapSize);
  setTimeout(fixMapSize, 250);
  window.addEventListener("resize", fixMapSize, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(fixMapSize, 250), { passive: true });

  // ==============================
  // GEOLOCALIZZAZIONE
  // ==============================
  const locateBtn = document.getElementById("locate-btn");
  let userMarker = null;

  if (!locateBtn) {
    console.warn('Bottone "#locate-btn" non trovato: geolocalizzazione disabilitata');
  } else {
    locateBtn.addEventListener("click", () => {
      console.log("locate-btn click");

      if (!navigator.geolocation) {
        alert("Geolocation is not supported in this browser.");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          console.log("📍 Posizione:", { latitude, longitude, accuracy });

          map.setView([latitude, longitude], 16);

          if (userMarker) {
            userMarker.setLatLng([latitude, longitude]);
          } else {
            userMarker = L.marker([latitude, longitude])
              .addTo(map)
              .bindPopup("You are here")
              .openPopup();
          }

          // INVIO POSIZIONE VIA WEBSOCKET
          sendMessage({
            type: "position",
            lat: latitude,
            lng: longitude,
            accuracy,
          });
        },
        (err) => {
          console.warn("Geolocation error:", err);
          alert("Unable to get your location.");
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000,
        }
      );
    });
  }

  // ==============================
  // TEST MANUALE (opzionale)
  // ==============================
  window.sendTest = () => {
    console.log("sendTest()");
    sendMessage({
      type: "test",
      msg: "ciao dal frontend",
    });
  };
});