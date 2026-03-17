import { connectWebSocket, sendMessage } from "./ws.js";

window.addEventListener("DOMContentLoaded", () => {
  console.log("MAIN JS LOADED");

  // ==============================
  // WEBSOCKET CONNECTION
  // ==============================
  try {
    connectWebSocket();
    console.log("WS CONNECTED");
  } catch (err) {
    console.error("WebSocket connection failed:", err);
  }

  // ==============================
  // MAP INITIALIZATION
  // ==============================
  let map = null;
  let userMarker = null;

  const mapEl = document.getElementById("map");

  if (mapEl && typeof window.L !== "undefined") {
    try {
      map = L.map(mapEl, {
        zoomControl: true,
        preferCanvas: true,
      }).setView([38.1157, 13.3615], 13);

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      // Fix map size on load/resizes
      const fixMapSize = () => {
        try {
          map.invalidateSize();
        } catch (e) {
          // swallow error, map object might not exist
        }
      };
      requestAnimationFrame(fixMapSize);
      setTimeout(fixMapSize, 250);
      window.addEventListener("resize", fixMapSize, { passive: true });
      window.addEventListener("orientationchange", () => setTimeout(fixMapSize, 250), { passive: true });

      console.log("MAP INIT");
    } catch (err) {
      console.error("Error initializing map:", err);
    }
  } else {
    if (!mapEl) {
      console.warn('No element with id "map" found, skipping map initialization');
    }
    if (typeof window.L === "undefined") {
      console.error("Leaflet not found (L), check script includes in index.html");
    }
  }

  // ==============================
  // GEOLOCATION LOGIC
  // ==============================
  const locateBtn = document.getElementById("locate-btn");

  if (!locateBtn) {
    console.warn('No element with id "locate-btn" found, geolocation disabled');
  } else {
    locateBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        alert("Geolocation is not supported in this browser.");
        return;
      }
      if (!map) {
        alert("Map not initialized. Cannot use geolocation.");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          map.setView([latitude, longitude], 16);

          if (userMarker) {
            userMarker.setLatLng([latitude, longitude]);
          } else {
            userMarker = L.marker([latitude, longitude])
              .addTo(map)
              .bindPopup("You are here")
              .openPopup();
          }

          sendMessage({
            type: "position",
            lat: latitude,
            lng: longitude,
            accuracy,
          });

          console.log("POSITION SENT", { lat: latitude, lng: longitude, accuracy });
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
  // TEST SEND FUNCTION (OPTIONAL)
  // ==============================
  window.sendTest = () => {
    sendMessage({
      type: "test",
      msg: "ciao dal frontend",
    });
    console.log("sendTest() called");
  };
});