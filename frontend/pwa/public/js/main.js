// ACTIVE BUNDLE: loaded by `public/main.js` via `import "./js/main.js"`. Do not rename to *.UNUSED.js.
const API_BASE = "http://localhost:3000/api";
const WS_URL = "ws://localhost:3000/api/ws";
const SESSION_USER_KEY = "userId";
const CAR_API_BASE = "http://localhost:3000/api";

window.addEventListener("load", () => {
  try {
    if (typeof window.connectWebSocket === "function") window.connectWebSocket();
    if (typeof window.startGPS === "function") window.startGPS();
  } catch (e) {
    console.log("startup failed:", e);
  }
});

/* MAPPA */

window.addEventListener("DOMContentLoaded", () => {
 console.log("main.js executing");
 console.log("DOMContentLoaded");

 const userId = localStorage.getItem(SESSION_USER_KEY);
 if (!userId) {
  window.location.href = "/login.html";
  return;
 }

 const mapEl = document.getElementById("map");
 if (!mapEl) {
  console.warn('Elemento "#map" non trovato: skip map init');
  return;
 }
 if (typeof window.L === "undefined") {
  console.error("Leaflet (L) non caricato");
  return;
 }

 console.log("MAP INIT");
 const map = L.map("map").setView([38.1157,13.3615],13);
 const upostuIcon = L.icon({
  iconUrl: "/upostu-marker.png",
  iconSize: [40, 40],
  // Square spot icon: anchor at image center (not pin tip) so lat/lng matches the visible "P" box.
  iconAnchor: [20, 20],
  popupAnchor: [0, -20],
 });

 L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
  attribution:"© OpenStreetMap"
 }).addTo(map);

 // Mobile: ensure the map container size is computed before rendering tiles
 const fixMapSize = () => {
  try { map.invalidateSize(); } catch(e) { console.warn("invalidateSize failed:", e); }
 };
 fixMapSize();
 requestAnimationFrame(fixMapSize);
 setTimeout(fixMapSize, 200);
 window.addEventListener("resize", fixMapSize, { passive: true });
 window.addEventListener("orientationchange", () => setTimeout(fixMapSize, 200), { passive: true });

 // Debug handle (useful on mobile Safari remote debugging)
 window.__upostuMap = map;


/* CLUSTER */

const markers = L.markerClusterGroup({
  zoomToBoundsOnClick: false,
});
map.addLayer(markers);


/* MARKER UTENTE ARRIVO */

let incomingUserMarker = null;


/* WEBSOCKET */

let socket = null;
function connectWebSocket() {
 if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
  console.log("WS already connected/connecting");
  return;
 }

 try {
    console.log("WS connecting...", WS_URL);
  socket = new WebSocket(WS_URL);
    window.ws = socket;
    console.log("WS init", WS_URL);
 } catch (e) {
  console.warn("WS init failed:", e);
  return;
 }

 // Complete WebSocket handler (minimal + safe)
  socket.onopen = () => console.log("WebSocket connected");
  socket.onclose = () => console.log("WebSocket disconnected");
  socket.onerror = (e) => console.log("WS error", e);
 socket.onmessage = (event)=>{

  let message;
  try {
   message = JSON.parse(event.data);
  } catch (e) {
   console.warn("Non-JSON WS message (ignored):", event.data);
   return;
  }
  console.log("WS incoming:", message);

  // New message format handler (does not break existing code).
  try {
   if (handleWSMessage(message) === true) return;
  } catch (e) {
   console.warn("handleWSMessage failed:", e);
  }

  if(message.event==="parking_spot_created"){
   // Ensure when a parking spot is released, we always use fresh GPS coordinates!
   // This code assumes there is some function or logic that triggers "release spot".
   // We'll show a safe pattern you MUST use: always call navigator.geolocation.getCurrentPosition
   // and ensure those coords are sent to backend and used for marker.
   //
   // Example usage (should go wherever your "release" button handler is):

   function releaseSpot() {
     if (!navigator.geolocation) {
       alert("Geolocation is not supported by your browser");
       return;
     }
     navigator.geolocation.getCurrentPosition(
       function(pos) {
         const lat = pos.coords.latitude;
         const lng = pos.coords.longitude;
         // log real GPS coords for debugging:
         console.log("[RELEASE] GPS position acquired:", { lat, lng });

         // Example: Send to backend (adapt as needed)
         fetch("/api/release_spot", {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({
             lat: lat,
             lng: lng,
             // ...any other required data
           })
         }).then(res => res.json()).then(data => {
           console.log("[RELEASE] Sent these coordinates to backend:", { lat, lng });
           // add marker to map at real coords (for instant UI feedback)
           const marker = L.marker([lat, lng]);
           marker.bindPopup("Spot released here").openPopup();
           markers.addLayer(marker);
         }).catch(e => {
           console.warn("[RELEASE] Error releasing spot:", e);
         });
       },
       function(err) {
         alert("Unable to get your position: " + err.message);
       },
       {
         enableHighAccuracy: true,
         timeout: 6000,
         maximumAge: 0
       }
     );
   }

   // NOTE:
   // - Always use coordinates from the just-returned pos.coords, never from a global variable or from a user's stored location. Don't invert lat/lng (keep [lat, lng] everywhere)!
   // - Make sure your backend ensures lat/lng fields from client are used as received.
   // - For advanced implementations with a Redux store or Vuex/etc, update the relevant module to ensure the spot release logic always gets fresh coordinates from geolocation.

   const marker=createMarker(message.data);
   if (marker) markers.addLayer(marker);

   // Keep cache in sync for nearest-distance computations.
   const lat =
     typeof message.data.lat === "number"
       ? message.data.lat
       : message.data.latitude;
   const lng =
     typeof message.data.lng === "number"
       ? message.data.lng
       : message.data.longitude;
   if (typeof lat === "number" && typeof lng === "number") {
     parkingSpotsCache.push({
       id: message.data.id,
       lat,
       lng,
     });
   }

  }

  if(message.event==="user_location"){

   const user = message.data;

   if(!incomingUserMarker){

    incomingUserMarker=L.marker([user.latitude,user.longitude], { interactive: false, keyboard: false }).addTo(map);

   }else{

    incomingUserMarker.setLatLng([user.latitude,user.longitude]);

   }

   updateArrivalInfo(user.latitude,user.longitude);

  }

 };

 // expose on state for helpers like sendPosition
 state.socket = socket;
}

// Make globally accessible for window.onload.
window.connectWebSocket = connectWebSocket;


/* CREA MARKER */
const state = {
  socket: null,
  userId: null,
  users: {},
  markers: {}
};

let currentStatus = "searching";

// Active parking spots created by users leaving.
let activeSpots = [];
let targetSpot = null;
const spotMarkers = {};
/** TEMP: default Leaflet marker at same coords to verify custom icon anchor — set false or delete after confirmation. */
const DEBUG_ALIGN_SPOT_DEFAULT_MARKER = true;
const spotAlignDebugMarkers = {};
let pendingLeaveSend = false;
const notifiedSpotIds = new Set();
let lastNotifiedSpotId = null;
let lastClaimedSpotId = null;
// Monetization unlock state (reveals exact coords in UI only after server unlock).
const unlockedSpotIds = new Set(); // spotUserId strings
const UNLOCK_PRICE_EUR = 0.50; // fixed display price
const APPROX_COORD_DECIMALS = 4; // ~11m resolution

// Owner view: when I left a spot, track exact coords + who reserved it.
let myCreatedSpotUserId = null;
let myCreatedSpotLatLng = null; // {lat, lng}
let ownerReservedBuyerUserId = null;

// Buyer view: after unlock/payment, store destination coords for navigation.
let lastUnlockedSpotUserId = null;
let lastUnlockedSpotLatLng = null; // {lat, lng}

// Saved car location (local-only).
const SAVED_CAR_LAT_KEY = "upostu_saved_car_lat";
const SAVED_CAR_LNG_KEY = "upostu_saved_car_lng";

// Auth (MVP): token kept client-side to identify userId/uid for Stripe + websocket.
// Server validates token signature for protected REST endpoints.
const AUTH_TOKEN_KEY = "upostu_auth_token";

// Used when creating a new spot (owner -> backend checks small vs large cars).
const ACTIVE_CAR_SIZE_KEY = "upostu_active_car_size";

// Proximity radar state.
let radarLastTier = "none";
let radarLastBeepAtMs = 0;
let radarAudioCtx = null;

let hasAnnouncedArrival = false;
let toastTimer = null;
let gpsLoading = false;

let userIsAdmin = false;

function touchUserActivity(userId, status, lat, lng, isAdmin) {
  if (!userId) return;
  const marker = state.markers[userId] || null;
  const existing = state.users[userId];
  state.users[userId] = {
    marker: marker || (existing && existing.marker) || null,
    lastUpdate: Date.now(),
    status: status || (existing && existing.status) || null,
    lat: typeof lat === "number" && isFinite(lat) ? lat : existing && existing.lat,
    lng: typeof lng === "number" && isFinite(lng) ? lng : existing && existing.lng,
    isAdmin: typeof isAdmin === "boolean" ? isAdmin : existing && existing.isAdmin,
  };

  // Redirect when *this* client is admin (server validated).
  try {
    const myUserId = getOrCreateUserId();
    if (String(userId) === String(myUserId) && isAdmin === true) {
      userIsAdmin = true;
      const isDesktop = window.innerWidth >= 768;
      if (isDesktop && !String(location.pathname).startsWith("/admin")) {
        location.href = "/admin";
      }
    }
  } catch (e) {}
}

function decodeUidFromToken(token) {
  try {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payloadB64 = parts[0];
    // base64url -> base64
    let b64 = payloadB64.replaceAll("-", "+").replaceAll("_", "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const decoded = atob(b64);
    // auth router encodes payload as: "{'sub': 'UID', 'exp': 123}"
    const m = decoded.match(/'sub'\s*:\s*'([^']+)'/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

function getOrCreateUserId() {
  if (state.userId) return state.userId;
  try {
    const storedUserId = localStorage.getItem(SESSION_USER_KEY);
    if (storedUserId) {
      state.userId = String(storedUserId);
      return state.userId;
    }
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      const uid = decodeUidFromToken(token);
      if (uid) {
        state.userId = uid;
        localStorage.setItem(SESSION_USER_KEY, String(uid));
        return state.userId;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

function requireUserIdOrRedirect() {
  const uid = getOrCreateUserId();
  if (uid) return uid;
  window.location.href = "/login.html";
  return null;
}

function formatEuro(amount) {
  const n = typeof amount === "number" && isFinite(amount) ? amount : 0;
  return `€${n.toFixed(2)}`;
}

async function refreshWalletUI() {
  const el = document.getElementById("wallet-amount");
  if (!el) return;
  const userId = requireUserIdOrRedirect();
  if (!userId) return;
  try {
    const res = await fetch(`${API_BASE}/wallet?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    if (typeof data.balance === "number") el.textContent = formatEuro(data.balance);
  } catch (e) {
    // ignore
  }
}

async function loadUnlockedSpotsFromServer() {
  const userId = requireUserIdOrRedirect();
  if (!userId) return;
  try {
    const res = await fetch(`${API_BASE}/unlocks?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
    const data = await res.json();
    if (Array.isArray(data && data.unlocked)) {
      for (const sid of data.unlocked) unlockedSpotIds.add(String(sid));
    }
    // If spots already arrived, re-render markers (approx -> exact) accordingly.
    if (Array.isArray(activeSpots)) updateSpotsMarkers(activeSpots);
    syncLastUnlockedSpotFromSpots();
    updateNavigationButtons();
  } catch (e) {
    // ignore
  }
}

async function loadUserCarDisplay() {
  const el = document.getElementById("user-car-display");
  if (!el) return;
  const userId = (localStorage.getItem(SESSION_USER_KEY) || "").trim();
  if (!userId) {
    el.textContent = "";
    return;
  }
  try {
    const res = await fetch(`${CAR_API_BASE}/user-cars?userId=${encodeURIComponent(userId)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    const cars = Array.isArray(data && data.cars) ? data.cars : [];
    const car = cars.find((c) => String(c.userId || c.user_uid || "") === userId) || null;
    if (!car) {
      el.textContent = "No car saved yet. Add one in Profile.";
      return;
    }
    el.textContent = `My car: ${car.brand} ${car.model} (${car.size})`;
  } catch (e) {
    console.error("Unable to load car:", e);
    el.textContent = "Unable to load car.";
  }
}

function setupWalletTopup() {
  const btn5 = document.getElementById("topup-5");
  const btn10 = document.getElementById("topup-10");
  const btn20 = document.getElementById("topup-20");
  if (!btn5 && !btn10 && !btn20) return;

  const topup = async (amount) => {
    const userId = requireUserIdOrRedirect();
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount }),
      });
      const data = await res.json();
      const el = document.getElementById("wallet-amount");
      if (el && typeof data.balance === "number") el.textContent = formatEuro(data.balance);
    } catch (e) {
      // ignore
    }
  };

  if (btn5) btn5.addEventListener("click", () => topup(5), { passive: true });
  if (btn10) btn10.addEventListener("click", () => topup(10), { passive: true });
  if (btn20) btn20.addEventListener("click", () => topup(20), { passive: true });

  refreshWalletUI();
}

function sendPosition(lat, lng) {
  const userId = requireUserIdOrRedirect();
  if (!userId) return;
  const ws = state.socket;
  const payload = { type: "update_position", userId, lat, lng, status: currentStatus };

  console.log("WS sendPosition:", payload);

  // Always send HTTP update so admin dashboard APIs stay in sync.
  fetch(`${API_BASE}/update-position`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      lat,
      lng,
      status: currentStatus,
    }),
  }).catch((e) => console.warn("update-position failed:", e));

  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (e) {
    console.warn("sendPosition failed:", e);
  }
}

function sendLeaveSpot(lat, lng) {
  const userId = requireUserIdOrRedirect();
  if (!userId) return;
  const activeCarSize = localStorage.getItem(ACTIVE_CAR_SIZE_KEY) || "large";
  const payload = { type: "new_spot", userId, lat, lng, spotSize: activeCarSize };
  const ws = state.socket;

  // Always send HTTP spot creation so admin dashboard APIs stay in sync.
  fetch(`${API_BASE}/create-spot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      lat,
      lng,
      spotSize: activeCarSize,
    }),
  }).catch((e) => console.warn("create-spot failed:", e));

  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {}
  }

  // Remember my exact leaving coordinates (owner view needs it).
  try {
    myCreatedSpotUserId = String(userId);
    myCreatedSpotLatLng = { lat, lng };
    ownerReservedBuyerUserId = null;
  } catch (e) {}
}

function sendRemoveSpot(spotUserId) {
  const ws = state.socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payload = { type: "spot_remove", spotUserId };
  try {
    ws.send(JSON.stringify(payload));
  } catch (e) {}
}

function sendClaimSpot(spotUserId) {
  const ws = state.socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const userId = requireUserIdOrRedirect();
  if (!userId) return;
  const payload = { type: "claim", userId, spotUserId };
  try {
    ws.send(JSON.stringify(payload));
  } catch (e) {}
}

function notifyNearbySpotOnce(spotUserId) {
  if (!spotUserId) return;
  const id = String(spotUserId);
  if (notifiedSpotIds.has(id)) return;
  notifiedSpotIds.add(id);
  lastNotifiedSpotId = id;
  // Simple notification, non-spam (once per spot).
  alert("Posto disponibile vicino");
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function requestPushPermissionIfNeeded() {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch (e) {}
}

async function bookSpot(spotId) {
  const userId = requireUserIdOrRedirect();
  if (!userId || !spotId) return;
  try {
    const res = await fetch(`${API_BASE}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spot_id: String(spotId), user_id: String(userId) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success !== true) {
      showToast("Booking failed");
      return;
    }
    showToast(`Booked: €${Number(data.booking && data.booking.price || 0).toFixed(2)}`);
  } catch (_e) {
    showToast("Booking failed");
  }
}
window.bookSpot = bookSpot;

function roundCoord(n, decimals) {
  if (typeof n !== "number" || !isFinite(n)) return n;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/** One canonical lat/lng for markers + popups (GeoJSON [lng,lat] or lat/lng fields). */
function normalizeSpotLatLng(spot) {
  if (!spot || typeof spot !== "object") return null;
  const gc = Array.isArray(spot.coordinates)
    ? spot.coordinates
    : spot.geometry && Array.isArray(spot.geometry.coordinates)
      ? spot.geometry.coordinates
      : null;
  if (gc && gc.length >= 2) {
    const lng = Number(gc[0]);
    const lat = Number(gc[1]);
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  const latRaw = spot.lat != null ? spot.lat : spot.latitude;
  const lngRaw = spot.lng != null ? spot.lng : spot.longitude;
  let lat = Number(latRaw);
  let lng = Number(lngRaw);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    const t = lat;
    lat = lng;
    lng = t;
  }
  return { lat, lng };
}

function getSpotDisplayLatLng(spot, myUserId) {
  const base = normalizeSpotLatLng(spot);
  if (!base) return null;
  const spotId = spot.userId != null ? String(spot.userId) : null;
  const exactLat = base.lat;
  const exactLng = base.lng;
  const unlocked = spotId && unlockedSpotIds.has(spotId);
  const isOwner = myUserId && spotId && String(spotId) === String(myUserId);
  return unlocked || isOwner
    ? { lat: exactLat, lng: exactLng }
    : {
        lat: roundCoord(exactLat, APPROX_COORD_DECIMALS),
        lng: roundCoord(exactLng, APPROX_COORD_DECIMALS),
      };
}

function updateSpotsMarkers(spots) {
  if (!DEBUG_ALIGN_SPOT_DEFAULT_MARKER) {
    for (const id in spotAlignDebugMarkers) {
      try {
        map.removeLayer(spotAlignDebugMarkers[id]);
      } catch (e) {}
      delete spotAlignDebugMarkers[id];
    }
  }
  const myUserId = String(getOrCreateUserId());
  const nextByUser = {};
  for (const s of spots) {
    if (!s || !s.userId) continue;
    const spotOwnerId = String(s.userId);
    const claimedBy = s.claimedBy != null ? String(s.claimedBy) : null;

    // Hide reserved spots from everyone except:
    // - the buyer (claimedBy == myUserId)
    // - the owner (spotOwnerId == myUserId)
    const hideForOthers = claimedBy && claimedBy !== myUserId && spotOwnerId !== myUserId;
    if (hideForOthers) continue;

    nextByUser[spotOwnerId] = s;
  }

  // Remove markers that are no longer present.
  for (const id in spotMarkers) {
    if (!nextByUser[id]) {
      try { map.removeLayer(spotMarkers[id]); } catch (e) {}
      delete spotMarkers[id];
      if (spotAlignDebugMarkers[id]) {
        try { map.removeLayer(spotAlignDebugMarkers[id]); } catch (e) {}
        delete spotAlignDebugMarkers[id];
      }
    }
  }

  // Add/update markers.
  for (const id in nextByUser) {
    const s = nextByUser[id];
    const display = getSpotDisplayLatLng(s, myUserId);
    const lat = display ? display.lat : null;
    const lng = display ? display.lng : null;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const claimedBy = s.claimedBy != null ? String(s.claimedBy) : null;
    const isClaimed = !!claimedBy;
    const status = isClaimed ? "occupied" : (s.status || "just_freed");
    const price = typeof s.price === "number" ? s.price : 1.5;

    const existing = spotMarkers[id];
    if (existing) {
      existing.setLatLng([lat, lng]);
      if (existing.__upostuClaimedBy !== claimedBy) existing.__upostuClaimedBy = claimedBy;
      existing.bindPopup(
        `🚗 Spot<br/>Status: ${status}<br/>€${price}<br/><button onclick="bookSpot('${id}')">Book</button>`
      );
      if (DEBUG_ALIGN_SPOT_DEFAULT_MARKER) {
        let dbg = spotAlignDebugMarkers[id];
        if (!dbg) {
          dbg = L.marker([lat, lng], {
            interactive: false,
            keyboard: false,
            zIndexOffset: -500,
            opacity: 0.75,
          }).addTo(map);
          spotAlignDebugMarkers[id] = dbg;
        } else {
          dbg.setLatLng([lat, lng]);
        }
      }
      continue;
    }

    const m = L.marker([lat, lng], {
      icon: upostuIcon,
      interactive: true,
      keyboard: false,
    }).addTo(map);
    m.__upostuClaimedBy = claimedBy;
    m.bindPopup(
      `🚗 Spot<br/>Status: ${status}<br/>€${price}<br/><button onclick="bookSpot('${id}')">Book</button>`
    );
    spotMarkers[id] = m;
    if (DEBUG_ALIGN_SPOT_DEFAULT_MARKER) {
      spotAlignDebugMarkers[id] = L.marker([lat, lng], {
        interactive: false,
        keyboard: false,
        zIndexOffset: -500,
        opacity: 0.75,
      }).addTo(map);
    }
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateMarkerTo(marker, toLat, toLng, durationMs) {
  if (!marker) return;

  const from = marker.getLatLng();
  const fromLat = from.lat;
  const fromLng = from.lng;

  // If we don't have a meaningful delta, snap to avoid wasted frames.
  if (!isFinite(fromLat) || !isFinite(fromLng)) {
    marker.setLatLng([toLat, toLng]);
    return;
  }
  const dLat = Math.abs(toLat - fromLat);
  const dLng = Math.abs(toLng - fromLng);
  if (dLat + dLng < 1e-10) return;

  // Cancel any in-flight animation on this marker.
  if (marker.__upostuAnimRafId) {
    cancelAnimationFrame(marker.__upostuAnimRafId);
    marker.__upostuAnimRafId = null;
  }

  const start = performance.now();
  const dur = Math.max(0, durationMs | 0);

  const step = (now) => {
    const rawT = dur === 0 ? 1 : (now - start) / dur;
    const t = rawT >= 1 ? 1 : rawT <= 0 ? 0 : rawT;
    const e = easeInOutCubic(t);

    const lat = fromLat + (toLat - fromLat) * e;
    const lng = fromLng + (toLng - fromLng) * e;
    marker.setLatLng([lat, lng]);

    if (t < 1) {
      marker.__upostuAnimRafId = requestAnimationFrame(step);
    } else {
      marker.__upostuAnimRafId = null;
    }
  };

  marker.__upostuAnimRafId = requestAnimationFrame(step);
}

function getStatusColor(status) {
  if (status === "leaving") return "#ef4444";
  if (status === "searching") return "#22c55e";
  return "#9ca3af";
}

function applyUserMarkerStyle(marker, status) {
  if (!marker || typeof marker.setStyle !== "function") return;
  const color = getStatusColor(status);
  marker.setStyle({
    color,
    fillColor: color,
  });
  marker.__upostuStatus = status;
}

function updateUserMarker(userId, lat, lng, status) {
  if (!userId) return;
  if (typeof lat !== "number" || typeof lng !== "number") return;

  // Never override my own marker (always blue).
  if (userId === state.userId) return;

  const existing = state.markers[userId];
  if (existing) {
    // Smooth movement instead of jumping.
    animateMarkerTo(existing, lat, lng, 550);
    if (status && existing.__upostuStatus !== status) {
      applyUserMarkerStyle(existing, status);
    }
    return;
  }

  const color = getStatusColor(status);
  const marker = L.circleMarker([lat, lng], {
    radius: 7,
    color,
    weight: 3,
    fillColor: color,
    fillOpacity: 1,
    interactive: false,
    keyboard: false,
  });
  marker.__upostuStatus = status || null;
  marker.addTo(map);
  state.markers[userId] = marker;
}

function handleWSMessage(data) {
  if (!data || typeof data !== "object") return false;

  if (data.type === "users" && Array.isArray(data.users)) {
    // Replace/merge active user snapshot.
    for (const u of data.users) {
      if (!u || u.userId == null) continue;
      touchUserActivity(
        u.userId,
        u.status,
        typeof u.lat === "number" ? u.lat : Number(u.lat),
        typeof u.lng === "number" ? u.lng : Number(u.lng),
        u.isAdmin === true
      );
    }

    return true;
  }

  if (data.type === "spots") {
    activeSpots = Array.isArray(data.spots) ? data.spots : [];
    updateSpotsMarkers(activeSpots);
    requestPushPermissionIfNeeded();
    try {
      const me = state.users[String(state.userId)] || {};
      const myLat = Number(me.lat);
      const myLng = Number(me.lng);
      if (isFinite(myLat) && isFinite(myLng)) {
        for (const s of activeSpots) {
          const status = s && s.status ? String(s.status) : "just_freed";
          if (status !== "just_freed") continue;
          const lat = Number(s && s.lat);
          const lng = Number(s && s.lng);
          if (!isFinite(lat) || !isFinite(lng)) continue;
          if (haversineMeters(myLat, myLng, lat, lng) >= 300) continue;
          const sid = String(s.userId || s.id || "");
          if (!sid || notifiedSpotIds.has(sid)) continue;
          notifiedSpotIds.add(sid);
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("🚗 Spot available nearby!");
            } catch (_e) {}
          }
        }
      }
    } catch (_e) {}

    // Keep owner view + navigation destination in sync.
    syncOwnerReservedBuyerFromSpots();
    syncLastUnlockedSpotFromSpots();
    updateNavigationButtons();

    // If our target spot disappeared, clear it and notify.
    if (targetSpot && !activeSpots.some((s) => String(s.userId) === String(targetSpot.userId))) {
      targetSpot = null;
      hasAnnouncedArrival = false;
      showToast("Spot unavailable. Searching...");
    }
    return true;
  }

  if (data.type === "spot_unlocked") {
    try {
      const myUserId = String(getOrCreateUserId());
      const eventUserId = data.userId != null ? String(data.userId) : "";
      const spotUserId = data.spotUserId != null ? String(data.spotUserId) : "";
      if (eventUserId && spotUserId && eventUserId === myUserId) {
        unlockedSpotIds.add(spotUserId);
        lastUnlockedSpotUserId = spotUserId;
        syncLastUnlockedSpotFromSpots();
        updateNavigationButtons();
        // Reveal exact marker coordinates for that spot.
        updateSpotsMarkers(activeSpots);
        refreshWalletUI().catch(() => {});
      }
    } catch (e) {}
    return true;
  }

  if (data.type === "update" || data.type === "update_position") {
    const userId = data.userId;
    const lat = data.lat;
    const lng = data.lng;
    const status = data.status;
    const isAdmin = data.isAdmin === true;

    updateUserMarker(userId, lat, lng, status);
    touchUserActivity(userId, status, lat, lng, isAdmin);
    return true;
  }

  if (data.type === "disconnect") {
    const userId = data.userId;
    // Idempotent cleanup: remove marker/state if present, then clear user state.
    const marker = state.markers[userId];
    if (marker) {
      try { map.removeLayer(marker); } catch (e) {}
      delete state.markers[userId];
    }
    removeUserState(userId);
    return true;
  }

  return false;
}

// Cleanup inactive users: remove markers after a grace period (5–10s) with no position updates.
const USER_MARKER_INACTIVITY_MS = 8000;
setInterval(() => {
  const now = Date.now();
  for (const id in state.users) {
    const entry = state.users[id];
    if (!entry || typeof entry.lastUpdate !== "number") continue;
    if (now - entry.lastUpdate > USER_MARKER_INACTIVITY_MS) {
      removeUserState(id);
    }
  }
}, 2000);

function removeUserState(userId) {
  const entry = state.users[userId];
  const marker = (entry && entry.marker) || state.markers[userId];
  delete state.users[userId];
  if (marker) {
    try {
      if (marker.__upostuAnimRafId) cancelAnimationFrame(marker.__upostuAnimRafId);
    } catch (e) {}
    try {
      map.removeLayer(marker);
    } catch (e) {}
  }
  delete state.markers[userId];
}

function getUser(userId) {
  return state.users[userId] || null;
}

function createMarker(spot){

  const pos = normalizeSpotLatLng(spot);
  if (!pos) return null;
  const lat = pos.lat;
  const lng = pos.lng;

  // Visual-only markers: no click, no popup, no interaction.
  const marker = L.marker([lat, lng], {
    icon: upostuIcon,
    interactive: false,
    keyboard: false,
    clickable: false,
  });
  return marker;

}


/* CARICA PARCHEGGI */

async function loadParkingSpots(){

 const res=await fetch(`${API_BASE}/parking`);

 const spots=await res.json();

 parkingSpotsCache = Array.isArray(spots) ? spots : [];

 markers.clearLayers();

 spots.forEach(spot=>{

  const marker=createMarker(spot);
  if (marker) markers.addLayer(marker);

 });

}


/* GPS */

let userLat = null;
let userLng = null;
let gpsWatchId = null;
let myMarker = null;
let hasCenteredOnMe = false;

const leavingBox = document.getElementById("leaving-box");
const approachingBox = document.getElementById("approaching-box");

const leavingSpeedEl = document.getElementById("leaving-speed");
const leavingDistEl = document.getElementById("leaving-distance");
const leavingTimeEl = document.getElementById("leaving-time");

const approachingDistEl = document.getElementById("approaching-distance");
const approachingEtaEl = document.getElementById("approaching-eta");
const approachingStatusEl = document.getElementById("approaching-status");
const radarIndicatorEl = document.getElementById("radar-indicator");

const toastEl = document.getElementById("toast");
const loadingOverlayEl = document.getElementById("loading-overlay");
const loadingOverlayTitleEl = loadingOverlayEl ? loadingOverlayEl.querySelector(".title") : null;

const ownerBuyerBoxEl = document.getElementById("owner-buyer-box");
const ownerBuyerIdEl = document.getElementById("owner-buyer-id");
const ownerBuyerDistanceEl = document.getElementById("owner-buyer-distance");
const ownerBuyerStatusEl = document.getElementById("owner-buyer-status");

const navigateSpotBtnEl = document.getElementById("navigate-spot-btn");
const saveCarBtnEl = document.getElementById("save-car-btn");
const goToCarBtnEl = document.getElementById("go-to-car-btn");

// Monetization UI (reveals exact coordinates after server unlock)
const unlockBtnEl = document.getElementById("unlock-btn");
const unlockStatusEl = document.getElementById("unlock-status");

let parkingSpotsCache = [];

let leavingActive = false;
let approachingActive = false;
let leavingStartMs = 0;
let totalDistanceM = 0;
let lastTrackLat = null;
let lastTrackLng = null;
let lastTrackTs = null;
let lastSpeedKmh = 0;
let tickIntervalId = null;

function formatHMS(totalSeconds) {
  const s = Math.max(0, totalSeconds | 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function extractSpotLatLng(spot) {
  return normalizeSpotLatLng(spot);
}

function computeNearestDistanceAndEtaM(userLatLocal, userLngLocal) {
  if (!Array.isArray(parkingSpotsCache) || parkingSpotsCache.length === 0) {
    return null;
  }

  let bestDistM = Infinity;
  for (const spot of parkingSpotsCache) {
    const coords = extractSpotLatLng(spot);
    if (!coords) continue;
    const d = calculateDistance(userLatLocal, userLngLocal, coords.lat, coords.lng);
    if (d < bestDistM) bestDistM = d;
  }

  if (!isFinite(bestDistM)) return null;

  const speedMps = lastSpeedKmh && isFinite(lastSpeedKmh) ? lastSpeedKmh / 3.6 : 0;
  const effectiveSpeedMps = speedMps > 0.5 ? speedMps : 2.0; // fallback
  const etaSec = bestDistM / effectiveSpeedMps;

  // Arrival experience: trigger when the user is within 10m.
  const status = bestDistM <= 10 ? "arrived" : "approaching";
  return { distM: bestDistM, etaSec, status };
}

// ===========================
// Smooth UI box animations
// ===========================
const BOX_ANIM_HIDE_MS = 140;
const BOX_ACTIVE_MS = 520;

function animateGpsBox(boxEl, applyFn) {
  if (!boxEl) return;
  // Avoid stacking animations excessively.
  boxEl.classList.add("updating");
  setTimeout(() => {
    try {
      applyFn();
    } finally {
      boxEl.classList.remove("updating");
      boxEl.classList.add("active");
      setTimeout(() => boxEl.classList.remove("active"), BOX_ACTIVE_MS);
    }
  }, BOX_ANIM_HIDE_MS);
}

function setLeavingBoxInstant(speedKmH, distM, timeText) {
  if (!leavingSpeedEl || !leavingDistEl || !leavingTimeEl) return;
  leavingSpeedEl.textContent = String(speedKmH);
  leavingDistEl.textContent = String(distM);
  leavingTimeEl.textContent = String(timeText);
}

function updateLeavingBoxAnimated(values) {
  if (!leavingBox || !leavingSpeedEl || !leavingDistEl || !leavingTimeEl) return;

  const nextSpeed = String(values.speedKmH);
  const nextDist = String(values.distM);
  const nextTime = String(values.timeText);

  if (
    leavingSpeedEl.textContent === nextSpeed &&
    leavingDistEl.textContent === nextDist &&
    leavingTimeEl.textContent === nextTime
  ) {
    return;
  }

  animateGpsBox(leavingBox, () => {
    setLeavingBoxInstant(nextSpeed, nextDist, nextTime);
  });
}

function setApproachingBoxInstant(distM, etaSec, statusLabel, statusMode) {
  if (!approachingDistEl || !approachingEtaEl || !approachingStatusEl) return;
  approachingDistEl.textContent = String(distM);
  approachingEtaEl.textContent = formatHMS(Number(etaSec));
  approachingStatusEl.textContent = String(statusLabel);
  approachingStatusEl.classList.remove("approaching", "searching", "arrived");
  if (statusMode) approachingStatusEl.classList.add(statusMode);
}

function updateApproachingBoxAnimated(values) {
  if (!approachingBox || !approachingDistEl || !approachingEtaEl || !approachingStatusEl) return;

  const distStr = String(values.distM);
  const etaSec = Number(values.etaSec);
  const etaStr = formatHMS(etaSec);
  const statusLabel = String(values.statusLabel);
  const statusMode =
    values.statusMode ||
    (statusLabel === "arrived" ? "arrived" : statusLabel === "searching" ? "searching" : "approaching");

  if (
    approachingDistEl.textContent === distStr &&
    approachingEtaEl.textContent === etaStr &&
    approachingStatusEl.textContent === statusLabel &&
    approachingStatusEl.classList.contains(statusMode)
  ) {
    return;
  }

  animateGpsBox(approachingBox, () => {
    // etaSec -> HH:MM:SS
    approachingDistEl.textContent = distStr;
    approachingEtaEl.textContent = etaStr;
    approachingStatusEl.textContent = statusLabel;
    approachingStatusEl.classList.remove("approaching", "searching", "arrived");
    approachingStatusEl.classList.add(statusMode);
  });
}

function showToast(msg, ms = 2400) {
  if (!toastEl) return;
  if (!msg) return;
  try {
    toastEl.textContent = String(msg);
    toastEl.style.display = "block";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.display = "none";
    }, ms);
  } catch (e) {}
}

function setLoadingOverlay(on, title) {
  if (!loadingOverlayEl) return;
  try {
    loadingOverlayEl.style.display = on ? "flex" : "none";
    if (loadingOverlayTitleEl && title) loadingOverlayTitleEl.textContent = String(title);
  } catch (e) {}
}

function startGPSTracking() {
  if (!navigator.geolocation) {
    console.log("Geolocation not available");
    return;
  }
  if (gpsWatchId != null) return;

  // UX: show loading while we wait for the first GPS fix.
  if (userLat == null || userLng == null) {
    gpsLoading = true;
    setLoadingOverlay(true, "Waiting for GPS...");
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, speed } = pos.coords;
      userLat = latitude;
      userLng = longitude;

      if (gpsLoading) {
        gpsLoading = false;
        setLoadingOverlay(false);
      }

      // Show my current position (blue) and center only on first fix.
      if (!myMarker) {
        try {
          myMarker = L.circleMarker([latitude, longitude], {
            radius: 7,
            color: "#3b82f6",
            weight: 3,
            fillColor: "#3b82f6",
            fillOpacity: 1,
            interactive: false,
          }).addTo(map);
        } catch (e) {
          // If Leaflet isn't ready for any reason, just skip marker creation.
          myMarker = null;
        }
      } else {
        // Smoothly glide my marker too.
        animateMarkerTo(myMarker, latitude, longitude, 420);
      }

      if (!hasCenteredOnMe) {
        hasCenteredOnMe = true;
        try {
          map.setView([latitude, longitude], 16);
        } catch (e) {}
      }

      if (pendingLeaveSend) {
        pendingLeaveSend = false;
        sendLeaveSpot(latitude, longitude);
      }

      const nowTs = typeof pos.timestamp === "number" ? pos.timestamp : Date.now();

      if (
        lastTrackTs != null &&
        lastTrackLat != null &&
        lastTrackLng != null
      ) {
        const deltaDist = calculateDistance(
          lastTrackLat,
          lastTrackLng,
          latitude,
          longitude
        );

        // Track distance only when leaving parking is active.
        if (leavingActive && deltaDist > 1) totalDistanceM += deltaDist;

        const deltaTimeSec = (nowTs - lastTrackTs) / 1000;

        // Speed: prefer browser-provided speed (m/s). Otherwise derive from distance/time.
        let speedMps = null;
        if (typeof speed === "number" && isFinite(speed)) {
          speedMps = speed;
        } else if (deltaTimeSec > 0 && deltaDist >= 0) {
          speedMps = deltaDist / deltaTimeSec;
        }

        if (typeof speedMps === "number" && isFinite(speedMps)) {
          lastSpeedKmh = speedMps * 3.6;
        }
      }

      lastTrackLat = latitude;
      lastTrackLng = longitude;
      lastTrackTs = nowTs;
      sendPosition(latitude, longitude);
    },
    (err) => {
      gpsLoading = false;
      setLoadingOverlay(false);
      showToast("GPS unavailable");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    },
  );
}

window.startGPS = startGPSTracking;

/* ===========================
   LIVE GPS TRACKING MODES
   =========================== */

function startTicking() {
  if (tickIntervalId != null) return;

  tickIntervalId = setInterval(() => {
    // Owner UI (spot creator) + buyer radar (spot approaching) both update once per second.
    updateOwnerBuyerBox();
    updateCarPositionButtons();
    updateNavigationButtons();

    // BOX 1: Leaving parking
    if (leavingBox) {
      if (leavingActive) {
        const elapsedSec = Math.floor((Date.now() - leavingStartMs) / 1000);
        const speedText =
          typeof lastSpeedKmh === "number" && isFinite(lastSpeedKmh)
            ? `${lastSpeedKmh.toFixed(0)} km/h`
            : "0 km/h";
        const distText = `${Math.round(totalDistanceM)} m`;
        const timeText = formatHMS(elapsedSec);
        const nextSpeed = speedText.replace(" km/h", "");
        updateLeavingBoxAnimated({
          speedKmH: nextSpeed,
          distM: Math.round(totalDistanceM),
          timeText,
        });
      } else {
        updateLeavingBoxAnimated({
          speedKmH: 0,
          distM: 0,
          timeText: "00:00:00",
        });
      }
    }

    // BOX 2: Approaching nearest parking
    if (approachingBox) {
      if (approachingActive && userLat != null && userLng != null) {
        // Prefer real-time active spots; fallback to API parking spots if empty.
        const myUserId = getOrCreateUserId();

        // Nearby notification: once per spot within 100m (searching only).
        if (Array.isArray(activeSpots) && activeSpots.length > 0) {
          for (const s of activeSpots) {
            if (!s || !s.userId || typeof s.lat !== "number" || typeof s.lng !== "number") continue;
            const claimedBy = s.claimedBy != null ? String(s.claimedBy) : null;
            // Notify also for claimed spots? Keep it realistic: only unclaimed.
            if (claimedBy) continue;
              const coords = getSpotDisplayLatLng(s, myUserId);
              if (!coords) continue;
              const d = calculateDistance(userLat, userLng, coords.lat, coords.lng);
            if (d <= 100) {
              notifyNearbySpotOnce(String(s.userId));
            }
          }
        }

        if (!targetSpot && Array.isArray(activeSpots) && activeSpots.length > 0) {
          let best = null;
          let bestD = Infinity;
          for (const s of activeSpots) {
            if (!s || typeof s.lat !== "number" || typeof s.lng !== "number") continue;
            const claimedBy = s.claimedBy != null ? String(s.claimedBy) : null;
            // Approach lock: skip spots claimed by others.
            if (claimedBy && claimedBy !== String(myUserId)) continue;
            const coords = getSpotDisplayLatLng(s, myUserId);
            if (!coords) continue;
            const d = calculateDistance(userLat, userLng, coords.lat, coords.lng);
            if (d < bestD) { bestD = d; best = s; }
          }
          targetSpot = best;
        }

        let distM = null;
        let claimedBy = null;
        if (targetSpot && typeof targetSpot.lat === "number" && typeof targetSpot.lng === "number") {
          const coords = getSpotDisplayLatLng(targetSpot, myUserId);
          if (coords) distM = calculateDistance(userLat, userLng, coords.lat, coords.lng);
          claimedBy = targetSpot.claimedBy != null ? String(targetSpot.claimedBy) : null;
        }

        if (distM != null && isFinite(distM)) {
          const speedMps = lastSpeedKmh && isFinite(lastSpeedKmh) ? lastSpeedKmh / 3.6 : 0;
          const effectiveSpeedMps = speedMps > 0.5 ? speedMps : 2.0;
          const etaSec = distM / effectiveSpeedMps;
          const isArrived = distM <= 10;

          // Approach lock: when very close, claim spot for myself (once).
          if (!isArrived && distM <= 20 && targetSpot && targetSpot.userId) {
            const spotId = String(targetSpot.userId);
            const unlocked = unlockedSpotIds.has(spotId);
            if (unlocked) {
              if (lastClaimedSpotId !== spotId) {
                lastClaimedSpotId = spotId;
                sendClaimSpot(spotId);
              }
            }
          }

          const reservedForMe = claimedBy && claimedBy === String(myUserId);
          const reservedByOther = claimedBy && claimedBy !== String(myUserId);

          // Monetization UI: show unlock button when near an unclaimed locked spot.
          if (unlockBtnEl && unlockStatusEl) {
            const spotId = targetSpot && targetSpot.userId ? String(targetSpot.userId) : null;
            const isLocked = spotId && !unlockedSpotIds.has(spotId);
            const canUnlock =
              isLocked &&
              !reservedForMe &&
              !reservedByOther &&
              claimedBy == null &&
              distM <= 100;

            if (canUnlock) {
              unlockBtnEl.style.display = "block";
              unlockBtnEl.disabled = false;
              unlockStatusEl.textContent = `Locked spot. Unlock exact coordinates (${UNLOCK_PRICE_EUR.toFixed(2)}€).`;
            } else {
              unlockBtnEl.style.display = "none";
              unlockStatusEl.textContent = "";
            }
          }

          let statusLabel = "approaching";
          let statusMode = "approaching";
          if (reservedByOther) {
            statusLabel = "searching";
            statusMode = "searching";
          }
          if (reservedForMe) {
            statusLabel = "approaching";
            statusMode = "approaching";
          }
          if (isArrived) {
            statusLabel = "You have arrived";
            statusMode = "arrived";
          }

          // Buyer status drives both UI + what the spot owner sees in real time.
          currentStatus = isArrived ? "arrived" : reservedByOther ? "searching" : reservedForMe ? "approaching" : "approaching";

          // Radar effects based on proximity to the target spot.
          applyProximityRadarEffects(distM, !reservedByOther);

          updateApproachingBoxAnimated({
            distM: Math.round(distM),
            etaSec: Math.round(etaSec),
            statusLabel,
            statusMode,
          });

          // If another user claimed this spot while we were approaching, stop targeting it.
          if (reservedByOther) {
            targetSpot = null;
            hasAnnouncedArrival = false;
            showToast("Spot taken. Searching...");
          }

          if (isArrived && targetSpot && targetSpot.userId) {
            sendRemoveSpot(String(targetSpot.userId));
            targetSpot = null;
          }
        } else {
          const nearest = computeNearestDistanceAndEtaM(userLat, userLng);
          if (nearest) {
            applyProximityRadarEffects(nearest.distM, true);
            currentStatus = nearest.status === "arrived" ? "arrived" : "approaching";
            const isArrivedNearest = nearest.status === "arrived";
            updateApproachingBoxAnimated({
              distM: Math.round(nearest.distM),
              etaSec: Math.round(nearest.etaSec),
              statusLabel: isArrivedNearest ? "You have arrived" : nearest.status,
              statusMode: isArrivedNearest ? "arrived" : "approaching",
            });
          } else {
            applyProximityRadarEffects(null, false);
            currentStatus = "searching";
            updateApproachingBoxAnimated({
              distM: 0,
              etaSec: 0,
              statusLabel: "approaching",
            });
          }
        }
      } else if (!approachingActive) {
        if (unlockBtnEl) unlockBtnEl.style.display = "none";
        if (unlockStatusEl) unlockStatusEl.textContent = "";
        applyProximityRadarEffects(null, false);
        updateApproachingBoxAnimated({
          distM: 0,
          etaSec: 0,
          statusLabel: "approaching",
        });
      }
    }
  }, 1000);
}

function startLeavingTracking() {
  startGPSTracking();
  currentStatus = "leaving";
  leavingActive = true;
  approachingActive = false;
  leavingStartMs = Date.now();
  totalDistanceM = 0;
  lastTrackLat = null;
  lastTrackLng = null;
  lastTrackTs = null;
  lastSpeedKmh = 0;

  if (leavingBox) updateLeavingBoxAnimated({ speedKmH: 0, distM: 0, timeText: "00:00:00" });
  if (approachingBox) setApproachingBoxInstant(0, 0, "approaching", "approaching");

  startTicking();

  // Send "leave" spot once we have a GPS fix.
  if (userLat != null && userLng != null) {
    sendLeaveSpot(userLat, userLng);
  } else {
    pendingLeaveSend = true;
  }
}

function startApproachingTracking() {
  startGPSTracking();
  currentStatus = "searching";
  leavingActive = false;
  approachingActive = true;

  totalDistanceM = 0;
  lastTrackLat = null;
  lastTrackLng = null;
  lastTrackTs = null;
  lastSpeedKmh = 0;

  if (leavingBox) updateLeavingBoxAnimated({ speedKmH: 0, distM: 0, timeText: "00:00:00" });
  if (approachingBox) setApproachingBoxInstant(0, 0, "searching", "searching");

  startTicking();
  targetSpot = null;
}

/* LASCIO POSTO */

const leaveBtn = document.getElementById("leave-btn");
if (!leaveBtn) {
  console.warn('BUTTON MISSING: "leave-btn"');
} else
  leaveBtn.onclick = () => {
    startLeavingTracking();
  };

/* CERCO POSTO */

const findBtn = document.getElementById("find-btn");
if (!findBtn) {
  console.warn('BUTTON MISSING: "find-btn"');
} else
  findBtn.onclick = async () => {
    // Nearest computations depend on the full cache from GET /api/parking.
    if (!Array.isArray(parkingSpotsCache) || parkingSpotsCache.length === 0) {
      await loadParkingSpots().catch(() => {});
    }
    startApproachingTracking();
  };

const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.onclick = () => {
    localStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    window.location.href = "/login.html";
  };
}

let unlockInFlight = false;
if (unlockBtnEl) {
  unlockBtnEl.style.display = "none";
  unlockBtnEl.onclick = async () => {
    if (unlockInFlight) return;
    if (!targetSpot || !targetSpot.userId) return;

    const spotUserId = String(targetSpot.userId);
    if (unlockedSpotIds.has(spotUserId)) return;

    unlockInFlight = true;
    try {
      unlockBtnEl.disabled = true;
      if (unlockStatusEl) unlockStatusEl.textContent = "Redirecting to Stripe...";

      setLoadingOverlay(true, "Processing payment...");

      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        setLoadingOverlay(false);
        throw new Error("Please login to unlock a spot.");
      }

      const res = await fetch(`${API_BASE}/stripe/create-unlock-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ spotUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.detail || data.error || "Failed to create Stripe session";
        throw new Error(msg);
      }
      if (data && data.url) {
        setLoadingOverlay(false);
        window.location.href = data.url;
      } else {
        setLoadingOverlay(false);
        throw new Error("Stripe session URL missing");
      }
    } catch (e) {
      if (unlockStatusEl) unlockStatusEl.textContent = "";
      setLoadingOverlay(false);
      showToast(String(e && e.message ? e.message : e) || "Payment failed");
      unlockInFlight = false;
      unlockBtnEl.disabled = false;
      return;
    }
  };
}

/* ===========================
   RESERVATION / NAVIGATION / RADAR
   =========================== */

function openGoogleMapsTo(lat, lng, label) {
  if (!isFinite(lat) || !isFinite(lng)) return;
  const dest = `${lat},${lng}`;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
  // label kept for future use; Google handles it via destination.
  void label;
  window.location.href = url;
}

function loadSavedCarLocation() {
  try {
    const lat = parseFloat(localStorage.getItem(SAVED_CAR_LAT_KEY));
    const lng = parseFloat(localStorage.getItem(SAVED_CAR_LNG_KEY));
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng };
  } catch (e) {
    return null;
  }
}

function saveCarPosition(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return;
  try {
    localStorage.setItem(SAVED_CAR_LAT_KEY, String(lat));
    localStorage.setItem(SAVED_CAR_LNG_KEY, String(lng));
  } catch (e) {
    // ignore
  }
  updateCarPositionButtons();
}

function updateCarPositionButtons() {
  const hasGpsFix = userLat != null && userLng != null && isFinite(userLat) && isFinite(userLng);
  if (saveCarBtnEl) {
    // Keep it visible only after we have a real GPS fix.
    saveCarBtnEl.style.display = hasGpsFix ? "block" : "none";
  }
  const saved = loadSavedCarLocation();
  if (goToCarBtnEl) {
    goToCarBtnEl.style.display = saved ? "block" : "none";
  }
}

function syncOwnerReservedBuyerFromSpots() {
  if (!myCreatedSpotUserId) {
    ownerReservedBuyerUserId = null;
    return;
  }
  const mySpot = Array.isArray(activeSpots)
    ? activeSpots.find((s) => s && String(s.userId) === String(myCreatedSpotUserId))
    : null;

  if (mySpot && mySpot.claimedBy != null) ownerReservedBuyerUserId = String(mySpot.claimedBy);
  else ownerReservedBuyerUserId = null;
}

function syncLastUnlockedSpotFromSpots() {
  // If we already know which spot was unlocked, try to attach coords from activeSpots.
  if (lastUnlockedSpotUserId) {
    const spot = Array.isArray(activeSpots)
      ? activeSpots.find((s) => s && String(s.userId) === String(lastUnlockedSpotUserId))
      : null;
    const pos = spot ? normalizeSpotLatLng(spot) : null;
    if (pos) {
      lastUnlockedSpotLatLng = { lat: pos.lat, lng: pos.lng };
    } else {
      lastUnlockedSpotLatLng = null;
    }
    return;
  }

  if (!Array.isArray(activeSpots) || unlockedSpotIds.size === 0) {
    lastUnlockedSpotLatLng = null;
    return;
  }

  // Best guess: nearest unlocked spot to my current position.
  let best = null;
  let bestDist = Infinity;

  for (const s of activeSpots) {
    if (!s || s.userId == null) continue;
    const spotUserId = String(s.userId);
    if (!unlockedSpotIds.has(spotUserId)) continue;
    const pos = normalizeSpotLatLng(s);
    if (!pos) continue;

    if (userLat != null && userLng != null && isFinite(userLat) && isFinite(userLng)) {
      const d = calculateDistance(userLat, userLng, pos.lat, pos.lng);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    } else if (!best) {
      best = s;
    }
  }

  if (best) {
    lastUnlockedSpotUserId = String(best.userId);
    const p = normalizeSpotLatLng(best);
    lastUnlockedSpotLatLng = p ? { lat: p.lat, lng: p.lng } : null;
  } else {
    lastUnlockedSpotLatLng = null;
  }
}

function updateNavigationButtons() {
  if (!navigateSpotBtnEl) return;
  if (lastUnlockedSpotLatLng) {
    navigateSpotBtnEl.style.display = "block";
  } else {
    navigateSpotBtnEl.style.display = "none";
  }
}

function updateOwnerBuyerBox() {
  if (!ownerBuyerBoxEl || !ownerBuyerIdEl || !ownerBuyerDistanceEl || !ownerBuyerStatusEl) return;

  if (!myCreatedSpotLatLng || !ownerReservedBuyerUserId) {
    ownerBuyerBoxEl.style.display = "none";
    return;
  }

  const buyer = state.users[ownerReservedBuyerUserId];
  if (!buyer || typeof buyer.lat !== "number" || typeof buyer.lng !== "number") {
    ownerBuyerBoxEl.style.display = "none";
    return;
  }

  const distM = calculateDistance(buyer.lat, buyer.lng, myCreatedSpotLatLng.lat, myCreatedSpotLatLng.lng);
  const distRounded = Math.round(distM);

  ownerBuyerIdEl.textContent = String(ownerReservedBuyerUserId);
  ownerBuyerDistanceEl.textContent = distRounded;

  const buyerStatus = String(buyer.status || "");
  const isArrived = distM <= 10 || buyerStatus === "arrived";
  const mode = isArrived ? "arrived" : "approaching";

  ownerBuyerStatusEl.textContent = mode;
  ownerBuyerStatusEl.classList.remove("approaching", "searching", "arrived");
  ownerBuyerStatusEl.classList.add(mode);
  ownerBuyerBoxEl.style.display = "block";
}

function beepTone(freqHz, durationSec) {
  try {
    const AudioContextCls = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCls) return;
    if (!radarAudioCtx) radarAudioCtx = new AudioContextCls();
    if (radarAudioCtx.state === "suspended") radarAudioCtx.resume().catch(() => {});

    const osc = radarAudioCtx.createOscillator();
    const gain = radarAudioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freqHz;

    // Envelope to avoid clicks.
    const now = radarAudioCtx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(radarAudioCtx.destination);

    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  } catch (e) {
    // Browsers may block audio without gesture; ignore.
  }
}

function applyProximityRadarEffects(distM, enabled = true) {
  if (!approachingBox || !radarIndicatorEl) return;

  if (!enabled || distM == null || !isFinite(distM)) {
    radarLastTier = "none";
    hasAnnouncedArrival = false;
    radarIndicatorEl.textContent = "Radar: —";
    approachingBox.style.boxShadow = "";
    return;
  }

  let tier = "none";
  if (distM < 10) tier = "fast";
  else if (distM < 50) tier = "medium";
  else if (distM < 100) tier = "slow";

  if (tier === "none") {
    radarLastTier = "none";
    hasAnnouncedArrival = false;
    radarIndicatorEl.textContent = "Radar: —";
    approachingBox.style.boxShadow = "";
    return;
  }

  // UI glow intensity.
  if (tier === "slow") {
    hasAnnouncedArrival = false;
    radarIndicatorEl.textContent = "Feedback: light";
    approachingBox.style.boxShadow =
      "0 0 0 1px rgba(255, 200, 0, 0.30), 0 0 20px rgba(255, 200, 0, 0.35), 0 20px 42px rgba(0,0,0,0.55)";
  } else if (tier === "medium") {
    hasAnnouncedArrival = false;
    radarIndicatorEl.textContent = "Feedback: strong";
    approachingBox.style.boxShadow =
      "0 0 0 1px rgba(59, 130, 246, 0.40), 0 0 26px rgba(59, 130, 246, 0.42), 0 20px 42px rgba(0,0,0,0.55)";
  } else {
    radarIndicatorEl.textContent = "Arrived";
    approachingBox.style.boxShadow =
      "0 0 0 1px rgba(16, 185, 129, 0.75), 0 0 44px rgba(16, 185, 129, 0.68), 0 30px 60px rgba(0,0,0,0.55)";

    if (!hasAnnouncedArrival) {
      hasAnnouncedArrival = true;
      showToast("You have arrived");
      try {
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      } catch (e) {}
      // Arrival sound (one-shot).
      beepTone(1400, 0.18);
      radarLastBeepAtMs = Date.now(); // prevent immediate follow-up beep
    }
  }

  // Sound beep.
  const nowMs = Date.now();
  let intervalMs = 1400;
  let freqHz = 500;
  let beepDurSec = 0.08;
  if (tier === "medium") {
    intervalMs = 850;
    freqHz = 800;
  } else if (tier === "fast") {
    intervalMs = 350;
    freqHz = 1200;
  }

  if (nowMs - radarLastBeepAtMs >= intervalMs) {
    radarLastBeepAtMs = nowMs;
    beepTone(freqHz, beepDurSec);
  }

  radarLastTier = tier;
}

/* Button wiring */
if (navigateSpotBtnEl) {
  navigateSpotBtnEl.onclick = () => {
    syncLastUnlockedSpotFromSpots();
    if (lastUnlockedSpotLatLng) {
      openGoogleMapsTo(lastUnlockedSpotLatLng.lat, lastUnlockedSpotLatLng.lng, "Parking spot");
      return;
    }
    if (targetSpot && typeof targetSpot.lat === "number" && typeof targetSpot.lng === "number") {
      openGoogleMapsTo(targetSpot.lat, targetSpot.lng, "Parking spot");
    }
  };
}

if (saveCarBtnEl) {
  saveCarBtnEl.onclick = () => {
    if (userLat == null || userLng == null) return;
    saveCarPosition(userLat, userLng);
  };
}

if (goToCarBtnEl) {
  goToCarBtnEl.onclick = () => {
    const saved = loadSavedCarLocation();
    if (!saved) return;
    openGoogleMapsTo(saved.lat, saved.lng, "My car");
  };
}

// Initial UI state.
syncOwnerReservedBuyerFromSpots();
syncLastUnlockedSpotFromSpots();
updateCarPositionButtons();
updateNavigationButtons();

/* DISTANZA */

function calculateDistance(lat1,lon1,lat2,lon2){

 const R=6371;

 const dLat=(lat2-lat1)*Math.PI/180;
 const dLon=(lon2-lon1)*Math.PI/180;

 const a=
 Math.sin(dLat/2)*Math.sin(dLat/2)+
 Math.cos(lat1*Math.PI/180)*
 Math.cos(lat2*Math.PI/180)*
 Math.sin(dLon/2)*Math.sin(dLon/2);

 const c=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));

 return R*c*1000;

}


/* ETA */

function updateArrivalInfo(lat,lon){

 const dist=calculateDistance(lat,lon,userLat,userLng);

 const speed=30;

 const eta=dist/(speed*1000/3600);

 const arrivalEl = document.getElementById("arrival-info");
 if (!arrivalEl) return;
 arrivalEl.innerHTML=`
 Utente in arrivo<br>
 Distanza: ${Math.round(dist)} m<br>
 Velocità: ${speed} km/h<br>
 ETA: ${Math.round(eta)} sec
 `;

}


/* AVVIO */

loadParkingSpots().catch(() => {});
loadUnlockedSpotsFromServer().catch(() => {});
setupWalletTopup();
loadUserCarDisplay();
});

