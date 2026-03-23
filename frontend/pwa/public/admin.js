const API_BASE = "http://localhost:8000";
const API_PREFIX = "/api";
const POLL_INTERVAL_MS = 2000;
/** Remove user markers from the map after this many ms without a position update (5–10s grace). */
const USER_MARKER_INACTIVITY_MS = 8000;
const SPOT_ICON_URL = "/upostu-marker.png";
const LEAVING_SPOT_ICON_URL = "/assets/parking_blue.png";
const LEAVING_SPOT_ICON_SIZE = [40, 40];
const WS_SPOTS_URL = "ws://localhost:8000/ws/spots";
/** TEMP: default Leaflet marker at same coords — set false or delete after alignment confirmation. */
const DEBUG_ALIGN_SPOT_DEFAULT_MARKER = true;
// --- FIX: Ensure Leaflet marker and popup use EXACT SAME coordinates from single source ---

function createSpotMarker(spot, map) {
  // Single source of truth for coordinates
  const lat = parseFloat(spot.lat);
  const lng = parseFloat(spot.lng);

  // Debug logs to verify coordinates and spot input
  console.log("MARKER LAT/LNG:", lat, lng);
  console.log("SPOT OBJECT:", spot);

  // Create the marker at the exact coordinates and add to map
  const marker = L.marker([lat, lng]).addTo(map);

  // Ensure popup uses the exact same coordinates
  marker.bindPopup(`<b>Active spot</b><br>Lat: ${lat}<br>Lng: ${lng}`);

  return marker;
}

function adminWsUrl() {
  try {
    const u = new URL(API_BASE);
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${u.host}/ws/admin`;
  } catch {
    return "ws://localhost:8000/ws/admin";
  }
}

// Utility to ensure Leaflet markers have correct [lat, lng] order
// If using GeoJSON order ([lng, lat]), swap to [lat, lng]
function leafletLatLngFromGeoJson(coords) {
  // coords: [lng, lat]
  if (!Array.isArray(coords) || coords.length < 2) {
    throw new Error("Invalid coordinates");
  }
  // Swap [lng, lat] -> [lat, lng]
  return [coords[1], coords[0]];
}

// Example usage (update your marker code as below):
// const [lng, lat] = geoJson.geometry.coordinates;
// L.marker([lat, lng]);
//
// Or, using the utility:
// L.marker(leafletLatLngFromGeoJson(geoJson.geometry.coordinates));
//
// Ensure popups also use [lat, lng] consistently
// ========== Leaflet marker coordinate consistency check/fix ==========

// Utility for logging and debugging marker coordinate issues (remove/comment out in production)
function logMarkerPlacement(markerTitle, rawCoords, usedCoords) {
  console.log(`[DEBUG] Placing marker for ${markerTitle}: raw=`, rawCoords, "used=", usedCoords);
}

// Patch all calls to L.marker to ensure [lat, lng]
// Scan for usages of L.marker and apply correction if necessary

// Example marker creation for spots (assuming geoJson from backend)
function createSpotMarker(spot) {
  // spot.position could be in GeoJSON or separate fields
  let latLng = null;
  if (spot.position && Array.isArray(spot.position.coordinates)) {
    // GeoJSON order: [lng, lat]
    const coords = spot.position.coordinates;
    latLng = leafletLatLngFromGeoJson(coords);
    logMarkerPlacement(`spot:${spot.id}`, coords, latLng);
  } else if (typeof spot.lat === "number" && typeof spot.lng === "number") {
    // Plain fields, already [lat, lng]
    latLng = [spot.lat, spot.lng];
    logMarkerPlacement(`spot:${spot.id}`, [spot.lat, spot.lng], latLng);
  } else if (
    typeof spot.latitude === "number" &&
    typeof spot.longitude === "number"
  ) {
    latLng = [spot.latitude, spot.longitude];
    logMarkerPlacement(`spot:${spot.id}`, [spot.latitude, spot.longitude], latLng);
  } else {
    // Fallback; cannot determine coordinates
    console.warn("[WARN] Spot does not have valid coordinates", spot);
    return null;
  }

  // Use exact same latLng for popups and marker
  const marker = L.marker(latLng, {
    icon: state.upostuIcon, // or custom icon if set up in main code
  });
  marker.bindPopup(`<b>Spot ${spot.id}</b>`);
  return marker;
}

// Example marker creation for users
function createUserMarker(user) {
  // Support fields: [user.lat, user.lng] or GeoJSON: user.position.coordinates
  let latLng = null;
  if (user.position && Array.isArray(user.position.coordinates)) {
    // GeoJSON order: [lng, lat]
    const coords = user.position.coordinates;
    latLng = leafletLatLngFromGeoJson(coords);
    logMarkerPlacement(`user:${user.id || user.uid || "?"}`, coords, latLng);
  } else if (typeof user.lat === "number" && typeof user.lng === "number") {
    latLng = [user.lat, user.lng];
    logMarkerPlacement(`user:${user.id || user.uid || "?"}`, [user.lat, user.lng], latLng);
  } else if (
    typeof user.latitude === "number" &&
    typeof user.longitude === "number"
  ) {
    latLng = [user.latitude, user.longitude];
    logMarkerPlacement(`user:${user.id || user.uid || "?"}`, [user.latitude, user.longitude], latLng);
  } else {
    console.warn("[WARN] User does not have valid coordinates", user);
    return null;
  }
  // Ensure marker and popup use the exact same lat/lng coordinates.
  // All the coordinate picking logic above results in `latLng`, which is always [lat, lng]
  // So, ensure we use latLng for both marker creation and popup positioning.
  // Remove any duplicate or mismatched coordinate extraction here.
  // If there was any other source (like user.data or similar), do not use it.
  // All marker and popup binding must use this one latLng.

  const marker = L.marker(latLng);
  marker.bindPopup(`<b>${user.email || user.uid || "User"}</b>`);
  return marker;
}

// Patch place where markers are actually added to map/marker layers.
// For example, when rendering or updating markers,
// always use the above helpers instead of raw L.marker calls.
// This ensures all marker coordinates use a single, consistent logic.


const els = {
  liveBadge: document.getElementById("live-badge"),
  liveNote: document.getElementById("live-note"),
  reloadBtn: document.getElementById("reloadBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  spotsTbody: document.getElementById("spots-tbody"),
  reservedSpotsTbody: document.getElementById("reserved-spots-tbody"),
  revenuePanel: document.getElementById("revenue-panel"),
  kpiUsers: document.getElementById("kpi-users"),
  kpiSpots: document.getElementById("kpi-spots"),
  kpiReserved: document.getElementById("kpi-reserved"),
  kpiMarkers: document.getElementById("kpi-markers"),
  analyticsNote: document.getElementById("analytics-note"),
  filterAll: document.getElementById("filter-all"),
  filterAvailable: document.getElementById("filter-available"),
  filterJustFreed: document.getElementById("filter-just-freed"),
  filterCheapest: document.getElementById("filter-cheapest"),
  centerUser: document.getElementById("center-user"),
};

const state = {
  users: [],
  adminUsers: [],
  activeSpots: [],
  reservedSpots: [],
  pollTimer: null,
  map: null,
  userMarkers: {},
  /** userId -> last time we received a position for this user (ms since epoch). */
  userMarkerLastSeen: {},
  spotMarkers: {},
  upostuIcon: null,
  statusIcons: {},
  markersLayer: null,
  currentFilter: "all",
  nearestSpotId: null,
  mapAutoCentered: false,
  ws: null,
  wsConnected: false,
  fallbackTimer: null,
  revenueData: {},
  sidebarSection: "stats",
  usersFullCache: [],
  uidToEmail: {},
  adminWs: null,
  adminWsConnected: false,
  adminDetailUserId: null,
  adminDetailUserUid: null,
};

function setLive(kind, note) {
  if (els.liveBadge) els.liveBadge.textContent = kind;
  if (els.liveNote) els.liveNote.textContent = note || "";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showAdminToast(message) {
  const host = document.getElementById("admin-toast-host");
  if (!host || !message) return;
  const el = document.createElement("div");
  el.className = "admin-toast";
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("admin-toast--visible"));
  setTimeout(() => {
    el.classList.remove("admin-toast--visible");
    setTimeout(() => el.remove(), 200);
  }, 3800);
}

function clearAdminDetailContext() {
  state.adminDetailUserId = null;
  state.adminDetailUserUid = null;
}

function handleAdminRealtimePayload(msg) {
  if (!msg || typeof msg !== "object") return;
  const t = msg.type;
  if (t === "transaction") {
    // [NO-OP: selection was from handleAdminRealtimePayload's transaction block, not updateSpots]
    // No coordinate logic in this selection; no changes necessary here.
    showAdminToast(`New transaction €${amt}`);
    loadWallet({ soft: true });
    if (state.sidebarSection === "users" && !state.adminDetailUserId) loadUsers();
    if (
      state.adminDetailUserId &&
      state.adminDetailUserUid &&
      String(msg.user_id) === state.adminDetailUserUid
    ) {
      loadUserDetail(state.adminDetailUserId);
    }
  } else if (t === "booking") {
    showAdminToast("New booking");
    loadStats({ soft: true });
    loadAdminTableSection("bookings", { soft: true });
    if (
      state.adminDetailUserId &&
      state.adminDetailUserUid &&
      String(msg.user_id) === state.adminDetailUserUid
    ) {
      loadUserDetail(state.adminDetailUserId);
    }
  }
}

function connectAdminWebSocket() {
  const url = adminWsUrl();
  try {
    const socket = new WebSocket(url);
    state.adminWs = socket;
    socket.onopen = () => {
      state.adminWsConnected = true;
    };
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleAdminRealtimePayload(msg);
      } catch (_e) {}
    };
    socket.onclose = () => {
      state.adminWsConnected = false;
      setTimeout(connectAdminWebSocket, 2000);
    };
    socket.onerror = () => {
      state.adminWsConnected = false;
    };
  } catch (_e) {
    setTimeout(connectAdminWebSocket, 2000);
  }
}

/* ---------- Sidebar: management panel ---------- */

function getSidebarContent() {
  return document.getElementById("sidebar-content");
}

function setSidebarNavActive(section) {
  state.sidebarSection = section;
  document.querySelectorAll(".admin-sidebar-nav .nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === section);
  });
}

function showSidebarLoading() {
  const el = getSidebarContent();
  if (el) el.innerHTML = `<p class="muted">Loading…</p>`;
}

function bindSidebarContentEvents() {
  const root = getSidebarContent();
  if (!root || root.dataset.delegateBound === "1") return;
  root.dataset.delegateBound = "1";
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-action='back-users']")) {
      loadUsers();
      return;
    }
    const card = e.target.closest("[data-user-id]");
    if (card && state.sidebarSection === "users") {
      const id = parseInt(card.getAttribute("data-user-id"), 10);
      if (Number.isFinite(id)) loadUserDetail(id);
    }
  });
}

async function fetchAdminJson(path) {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.detail ? JSON.stringify(data.detail) : res.statusText;
    throw new Error(msg || "Request failed");
  }
  return data;
}

async function loadUsers() {
  setSidebarNavActive("users");
  bindSidebarContentEvents();
  showSidebarLoading();
  try {
    const rows = await fetchAdminJson("/admin/users-full");
    const list = Array.isArray(rows) ? rows : [];
    state.usersFullCache = list;
    state.uidToEmail = {};
    for (const u of list) {
      if (u && u.uid != null) state.uidToEmail[String(u.uid)] = u.email || `User #${u.id}`;
    }
    const el = getSidebarContent();
    if (!el) return;
    if (list.length === 0) {
      el.innerHTML = `<p class="empty-hint">No users.</p>`;
      return;
    }
    el.innerHTML = `
      <p class="muted sidebar-section-title">Users — tap a card for details</p>
      <div class="user-card-list">
        ${list
          .map((u) => {
            const nCars = Array.isArray(u.cars) ? u.cars.length : 0;
            return `
            <div class="card user-card" data-user-id="${Number(u.id)}" role="button" tabindex="0">
              <div class="user-card-email">${escapeHtml(u.email || "—")}</div>
              <div class="user-card-meta">
                <span>Wallet <strong>€${Number(u.wallet || 0).toFixed(2)}</strong></span>
                <span>${nCars} car${nCars === 1 ? "" : "s"}</span>
              </div>
            </div>`;
          })
          .join("")}
      </div>`;
  } catch (e) {
    const el = getSidebarContent();
    if (el) el.innerHTML = `<p class="error">Failed to load: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadUserDetail(userId) {
  state.sidebarSection = "users";
  bindSidebarContentEvents();
  showSidebarLoading();
  try {
    const data = await fetchAdminJson(`/admin/user/${userId}`);
    const el = getSidebarContent();
    if (!el) return;
    const u = data.user || {};
    state.adminDetailUserId = userId;
    state.adminDetailUserUid = u.uid != null ? String(u.uid) : null;
    const cars = Array.isArray(data.cars) ? data.cars : [];
    const txs = Array.isArray(data.transactions) ? data.transactions : [];
    const bookings = Array.isArray(data.bookings) ? data.bookings : [];

    const carsHtml =
      cars.length > 0
        ? `<ul class="detail-list">${cars.map((c) => `<li>${escapeHtml(c.plate || "—")}</li>`).join("")}</ul>`
        : `<p class="muted">No cars registered.</p>`;

    const txHtml =
      txs.length > 0
        ? `<div class="detail-tx-list">
          ${txs
            .map((t) => {
              const typ = String(t.type || "").toLowerCase();
              const cls = typ === "spend" ? "tx-spend" : "tx-earn";
              const label = typ === "spend" ? "SPEND" : "EARN";
              const fee = Number(t.platform_fee || 0);
              return `
            <div class="detail-tx-row ${cls}">
              <span>${label}</span>
              <span class="tx-amt">€${Number(t.amount || 0).toFixed(2)}</span>
              ${fee > 0 ? `<span class="tx-fee muted">fee €${fee.toFixed(2)}</span>` : ""}
            </div>`;
            })
            .join("")}
        </div>`
        : `<p class="muted">No transactions.</p>`;

    const bookingsHtml =
      bookings.length > 0
        ? `<div class="sidebar-table-wrap"><table class="admin-table">
            <thead><tr><th>ID</th><th>Spot</th><th>€</th><th>Status</th></tr></thead>
            <tbody>
              ${bookings
                .map(
                  (b) => `
                <tr>
                  <td class="mono">${escapeHtml(b.id)}</td>
                  <td class="mono">${escapeHtml((b.spot_id || "").slice(0, 12) || "—")}</td>
                  <td>€${Number(b.price || 0).toFixed(2)}</td>
                  <td>${escapeHtml(b.status || "—")}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table></div>`
        : `<p class="muted">No bookings.</p>`;

    el.innerHTML = `
      <button type="button" class="btn-back-sidebar" data-action="back-users">← Users</button>
      <div class="detail-header">
        <h3 class="detail-title">${escapeHtml(u.email || "User")}</h3>
        <p class="detail-wallet muted">Wallet <strong class="text-bright">€${Number(u.wallet || 0).toFixed(2)}</strong></p>
        <p class="muted detail-sub">${escapeHtml(`${u.name || ""} ${u.surname || ""}`.trim() || "—")} · ID ${escapeHtml(String(u.id))}</p>
      </div>
      <section class="detail-section">
        <h4 class="detail-h">Cars</h4>
        ${carsHtml}
      </section>
      <section class="detail-section">
        <h4 class="detail-h">Transactions</h4>
        ${txHtml}
      </section>
      <section class="detail-section">
        <h4 class="detail-h">Bookings</h4>
        ${bookingsHtml}
      </section>`;
  } catch (e) {
    clearAdminDetailContext();
    const el = getSidebarContent();
    if (el) el.innerHTML = `<p class="error">Failed to load user: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadWallet(opts) {
  const soft = opts && opts.soft;
  if (!soft) {
    clearAdminDetailContext();
    setSidebarNavActive("wallet");
    bindSidebarContentEvents();
    showSidebarLoading();
  } else if (state.sidebarSection !== "wallet") {
    return;
  }
  try {
    const [usersRows, txs] = await Promise.all([
      fetchAdminJson("/admin/users-full"),
      fetchAdminJson("/admin/transactions"),
    ]);
    const uidToEmail = {};
    for (const u of Array.isArray(usersRows) ? usersRows : []) {
      if (u && u.uid != null) uidToEmail[String(u.uid)] = u.email || `User #${u.id}`;
    }
    const list = Array.isArray(txs) ? txs : [];
    const el = getSidebarContent();
    if (!el) return;
    if (list.length === 0) {
      el.innerHTML = `<p class="empty-hint">No transactions yet.</p><p class="muted small">Wallet movements will appear here.</p>`;
      return;
    }
    el.innerHTML = `
      <p class="muted sidebar-section-title">Wallet activity</p>
      <div class="wallet-tx-list">
        ${list
          .map((t) => {
            const typ = String(t.type || "").toLowerCase();
            const cls = typ === "spend" ? "tx-spend" : "tx-earn";
            const arrow = typ === "spend" ? "SPEND" : "EARN";
            const label = escapeHtml(uidToEmail[String(t.user_id)] || String(t.user_id || "—"));
            const amt = Number(t.amount || 0).toFixed(2);
            const pf = Number(t.platform_fee || 0);
            let block = `<div class="wallet-tx-item card wallet-tx-card">
            <div class="tx-line ${cls}">${label} → ${arrow} €${amt}</div>`;
            if (pf > 0) {
              block += `<div class="tx-line tx-platform">Platform → €${pf.toFixed(2)}</div>`;
            }
            block += `</div>`;
            return block;
          })
          .join("")}
      </div>`;
  } catch (e) {
    const el = getSidebarContent();
    if (el) el.innerHTML = `<p class="error">Failed to load: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadStats(opts) {
  const soft = opts && opts.soft;
  if (!soft) {
    clearAdminDetailContext();
    setSidebarNavActive("stats");
    bindSidebarContentEvents();
    showSidebarLoading();
  } else if (state.sidebarSection !== "stats") {
    return;
  }
  try {
    const [stats, revenue] = await Promise.all([
      fetchAdminJson("/admin/stats"),
      fetchAdminJson("/admin/revenue"),
    ]);
    const el = getSidebarContent();
    if (!el) return;
    const tu = stats.total_users ?? "—";
    const ts = stats.total_spots ?? "—";
    const tb = stats.total_bookings ?? "—";
    const totalRev = Number(revenue.total_revenue ?? 0);
    const platformEarn = Number(revenue.platform_earnings ?? revenue.total_platform ?? 0);
    el.innerHTML = `
      <p class="muted sidebar-section-title">Platform overview</p>
      <div class="stats-inline">
        <div class="stat-card"><div class="muted">Total users</div><div class="stat-val">${escapeHtml(String(tu))}</div></div>
        <div class="stat-card"><div class="muted">Total spots</div><div class="stat-val">${escapeHtml(String(ts))}</div></div>
        <div class="stat-card"><div class="muted">Total bookings</div><div class="stat-val">${escapeHtml(String(tb))}</div></div>
        <div class="stat-card stat-card-revenue"><div class="muted">Total revenue €</div><div class="stat-val">€${totalRev.toFixed(2)}</div></div>
        <div class="stat-card"><div class="muted">Platform earnings €</div><div class="stat-val">€${platformEarn.toFixed(2)}</div></div>
      </div>
      <p class="muted small revenue-note">Revenue from booking history (<code>/admin/revenue</code>).</p>`;
  } catch (e) {
    const el = getSidebarContent();
    if (el) el.innerHTML = `<p class="error">Failed to load: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadAdminTableSection(section, opts) {
  const soft = opts && opts.soft;
  const map = {
    cars: { path: "/admin/cars", render: renderCarsHtml },
    bookings: { path: "/admin/bookings", render: renderBookingsHtml },
  };
  const cfg = map[section];
  if (!cfg) return;
  if (!soft) {
    clearAdminDetailContext();
    setSidebarNavActive(section);
    bindSidebarContentEvents();
    showSidebarLoading();
  } else if (state.sidebarSection !== section) {
    return;
  }
  try {
    const data = await fetchAdminJson(cfg.path);
    const contentEl = getSidebarContent();
    if (contentEl) contentEl.innerHTML = cfg.render(data);
  } catch (e) {
    const contentEl = getSidebarContent();
    if (contentEl) contentEl.innerHTML = `<p class="error">Failed to load: ${escapeHtml(e.message)}</p>`;
  }
}

function renderCarsHtml(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return `<p class="empty-hint">No cars.</p>`;
  return `
    <div class="sidebar-table-wrap">
      <table class="admin-table">
        <thead><tr><th>ID</th><th>Plate</th><th>User</th><th>Vehicle</th></tr></thead>
        <tbody>
          ${list
            .map(
              (c) => `
            <tr>
              <td class="mono">${escapeHtml(c.id)}</td>
              <td>${escapeHtml(c.plate || "—")}</td>
              <td class="mono">${escapeHtml(c.user_id || "—")}</td>
              <td>${escapeHtml(`${c.brand || ""} ${c.model || ""}`.trim() || "—")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderBookingsHtml(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return `<p class="empty-hint">No bookings.</p>`;
  return `
    <div class="sidebar-table-wrap">
      <table class="admin-table">
        <thead><tr><th>ID</th><th>User</th><th>Spot</th><th>Price</th><th>Status</th><th>Start</th></tr></thead>
        <tbody>
          ${list
            .map(
              (b) => `
            <tr>
              <td class="mono">${escapeHtml(b.id)}</td>
              <td class="mono">${escapeHtml(b.user_id || "—")}</td>
              <td class="mono">${escapeHtml(b.spot_id || "—")}</td>
              <td>€${Number(b.price || 0).toFixed(2)}</td>
              <td>${escapeHtml(b.status || "—")}</td>
              <td class="mono">${escapeHtml((b.start_time || "").slice(0, 19) || "—")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function initSidebarNav() {
  document.querySelectorAll(".admin-sidebar-nav .nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.dataset.section;
      if (section === "users") loadUsers();
      else if (section === "wallet") loadWallet();
      else if (section === "stats") loadStats();
      else loadAdminTableSection(section);
    });
  });
  bindSidebarContentEvents();
}

function invalidateMapSoon() {
  setTimeout(() => {
    try {
      if (state.map) state.map.invalidateSize();
    } catch (_e) {}
  }, 200);
}

/**
 * Single source of truth for spot coordinates (marker + popup must use the same lat/lng).
 * Supports lat/lng, latitude/longitude, and GeoJSON-style [lng, lat] arrays.
 */
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

/* ---------- Map (Leaflet) ---------- */

async function initMap() {
  if (typeof window.L === "undefined") return;
  const mapEl = document.getElementById("map");
  if (!mapEl) return;

  state.map = L.map("map").setView([38.1157, 13.3615], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
  }).addTo(state.map);
  state.upostuIcon = L.icon({
    iconUrl: SPOT_ICON_URL,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
    className: "spot-glow",
  });
  state.statusIcons.available = L.icon({
    iconUrl: "/markers/green.png",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
    className: "",
  });
  state.statusIcons.occupied = L.icon({
    iconUrl: "/markers/red.png",
    iconSize: [36, 36],
    iconAnchor: [18, 18], // center of square marker
    popupAnchor: [0, -18], // popup right above marker center
    className: "",
  });
  state.statusIcons.just_freed = L.icon({
    iconUrl: LEAVING_SPOT_ICON_URL,
    iconSize: LEAVING_SPOT_ICON_SIZE,
    iconAnchor: [LEAVING_SPOT_ICON_SIZE[0] / 2, LEAVING_SPOT_ICON_SIZE[1] / 2],
    popupAnchor: [0, -(LEAVING_SPOT_ICON_SIZE[1] / 2)],
    className: "spot-glow",
  });
  state.markersLayer = L.layerGroup().addTo(state.map);
  window.markersLayer = state.markersLayer;

  state.map.on("click", (e) => {
    console.log("CLICK:", e.latlng.lat, e.latlng.lng);
  });

  invalidateMapSoon();
  window.addEventListener("resize", () => invalidateMapSoon());
}

function getSpotStatus(spot) {
  if (spot && spot.claimedBy != null) return "occupied";
  const ts = Number(spot && spot.timestamp);
  if (isFinite(ts) && Date.now() - ts < 120000) return "just_freed";
  return "available";
}

function getIcon(status) {
  if (status === "occupied") return state.statusIcons.occupied || state.upostuIcon;
  if (status === "just_freed") return state.statusIcons.just_freed || state.upostuIcon;
  return state.statusIcons.available || state.upostuIcon;
}

function startFallbackPolling() {
  if (state.fallbackTimer) return;
  state.fallbackTimer = setInterval(() => {
    refreshDashboard().catch(() => {
      setLive("Error", "Realtime fallback failed");
    });
  }, 5000);
}

function stopFallbackPolling() {
  if (!state.fallbackTimer) return;
  clearInterval(state.fallbackTimer);
  state.fallbackTimer = null;
}

function connectSpotsWebSocket() {
  try {
    const socket = new WebSocket(WS_SPOTS_URL);
    state.ws = socket;
    socket.onopen = () => {
      state.wsConnected = true;
      setLive("WS", "Live spots stream connected");
      stopFallbackPolling();
    };
    socket.onmessage = (event) => {
      try {
        const spots = JSON.parse(event.data);
        console.log("Realtime spots:", spots);
        state.activeSpots = Array.isArray(spots) ? spots.filter((s) => s && s.claimedBy == null) : [];
        state.reservedSpots = Array.isArray(spots) ? spots.filter((s) => s && s.claimedBy != null) : [];
        renderSpots();
        renderReservedSpots();
        renderRevenue(state.revenueData || {});
        updateSpots({ spots: Array.isArray(spots) ? spots : [] });
        updateOverview();
        invalidateMapSoon();
      } catch (_e) {}
    };
    socket.onclose = () => {
      state.wsConnected = false;
      setLive("HTTP", "Realtime disconnected, using fallback");
      startFallbackPolling();
      setTimeout(connectSpotsWebSocket, 1500);
    };
    socket.onerror = () => {
      state.wsConnected = false;
      setLive("HTTP", "Realtime error, using fallback");
      startFallbackPolling();
    };
  } catch (_e) {
    state.wsConnected = false;
    startFallbackPolling();
  }
}

function animateMarkerMove(marker, toLat, toLng, durationMs = 300) {
  if (!marker) return;
  const from = marker.getLatLng();
  const fromLat = from.lat;
  const fromLng = from.lng;
  const startedAt = performance.now();

  const tick = (now) => {
    const t = Math.min(1, (now - startedAt) / durationMs);
    const lat = fromLat + (toLat - fromLat) * t;
    const lng = fromLng + (toLng - fromLng) * t;
    marker.setLatLng([lat, lng]);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function updateUsers(users) {
  if (!state.map) return;
  const now = Date.now();
  const nextIds = new Set();
  for (const u of Array.isArray(users) ? users : []) {
    const userId = u && u.userId != null ? String(u.userId) : "";
    if (!userId) continue;
    const lat = typeof u.lat === "number" ? u.lat : Number(u.lat);
    const lng = typeof u.lng === "number" ? u.lng : Number(u.lng);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    nextIds.add(userId);
    state.userMarkerLastSeen[userId] = now;

    const existing = state.userMarkers[userId];
    if (existing) {
      animateMarkerMove(existing, lat, lng, 300);
      existing.bindPopup(`User: ${u.userId || "-"}<br>Status: ${u.status || "-"}`);
      continue;
    }

    const marker = L.circleMarker([lat, lng], {
      radius: 7,
      color: "#60a5fa",
      fillColor: "#3b82f6",
      fillOpacity: 0.9,
      weight: 2,
    }).bindPopup(`User: ${u.userId || "-"}<br>Status: ${u.status || "-"}`);
    marker.addTo(state.map);
    state.userMarkers[userId] = marker;
  }

  for (const id of Object.keys(state.userMarkers)) {
    if (nextIds.has(id)) continue;
    const lastSeen = state.userMarkerLastSeen[id];
    if (typeof lastSeen !== "number" || now - lastSeen < USER_MARKER_INACTIVITY_MS) continue;
    try {
      state.map.removeLayer(state.userMarkers[id]);
    } catch (_e) {}
    delete state.userMarkers[id];
    delete state.userMarkerLastSeen[id];
  }
}

function updateSpots(spotsData) {
  if (!state.map) return;
  const spots = Array.isArray(spotsData && spotsData.spots) ? spotsData.spots : [];
  if (spots.length > 0) {
    const first = spots[0];
    const firstPos = normalizeSpotLatLng(first);
    if (firstPos && !state.mapAutoCentered) {
      state.map.setView([firstPos.lat, firstPos.lng], 14);
    }
  }
  if (window.markersLayer) {
    window.markersLayer.clearLayers();
  }
  state.spotMarkers = {};
  let nearest = null;
  const firstUser = state.users && state.users[0] ? state.users[0] : null;
  const userLat = firstUser ? Number(firstUser.lat) : NaN;
  const userLng = firstUser ? Number(firstUser.lng) : NaN;
  for (const spot of spots) {
    const spotId =
      spot && spot.id != null
        ? String(spot.id)
        : spot && spot.userId != null
          ? String(spot.userId)
          : "";
    if (!spotId) continue;
    const pos = normalizeSpotLatLng(spot);
    if (!pos) continue;
    const lat = pos.lat;
    const lng = pos.lng;
    const status = getSpotStatus(spot);
    if (state.currentFilter === "available" && status !== "available") continue;
    if (state.currentFilter === "just_freed" && status !== "just_freed") continue;
    if (state.currentFilter === "cheapest" && !(spot.price != null || spot.amount != null)) continue;

    const marker = L.marker([lat, lng], {
      icon: getIcon(status),
    });
    marker.bindPopup(
      `Active spot<br/>Owner: ${spot.owner_id || spot.userId || "-"}<br/>Status: ${status}`
    );
    window.markersLayer.addLayer(marker);
    if (marker._icon) marker._icon.classList.add("spot-glow");
    state.spotMarkers[spotId] = marker;
    if (DEBUG_ALIGN_SPOT_DEFAULT_MARKER) {
      const alignDbg = L.marker([lat, lng], {
        interactive: false,
        keyboard: false,
        zIndexOffset: -500,
        opacity: 0.75,
      });
      window.markersLayer.addLayer(alignDbg);
    }
    if (isFinite(userLat) && isFinite(userLng)) {
      const d = (lat - userLat) * (lat - userLat) + (lng - userLng) * (lng - userLng);
      if (!nearest || d < nearest.d) nearest = { d, spotId };
    }
  }
  state.nearestSpotId = nearest ? nearest.spotId : null;
  if (state.nearestSpotId && state.spotMarkers[state.nearestSpotId] && state.spotMarkers[state.nearestSpotId]._icon) {
    state.spotMarkers[state.nearestSpotId]._icon.classList.add("nearest-ring");
  }

  const bounds = [];
  for (const id of Object.keys(state.userMarkers)) {
    const ll = state.userMarkers[id].getLatLng();
    bounds.push([ll.lat, ll.lng]);
  }
  for (const id of Object.keys(state.spotMarkers)) {
    const ll = state.spotMarkers[id].getLatLng();
    bounds.push([ll.lat, ll.lng]);
  }
  if (!state.mapAutoCentered && bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [30, 30] });
    state.mapAutoCentered = true;
  }
}

function formatNumber(n, digits = 6) {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  return n.toFixed(digits);
}

function formatTimestamp(ms) {
  if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return "-";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function renderUsers(users) {
  const table = document.getElementById("users-table");
  if (!table) return;
  const rows = Array.isArray(users) ? users : [];
  if (rows.length === 0) {
    table.innerHTML = `<tr class="empty-row"><td colspan="6">No users yet.</td></tr>`;
    return;
  }
  table.innerHTML = rows
    .map(
      (u) => `
        <tr>
          <td>${escapeHtml(u.name || "-")}</td>
          <td>${escapeHtml(u.surname || "-")}</td>
          <td>${escapeHtml(u.email || "-")}</td>
          <td>${escapeHtml(u.car || "-")}</td>
          <td>€${Number(u.total_earned || 0).toFixed(2)}</td>
          <td>€${Number(u.total_spent || 0).toFixed(2)}</td>
        </tr>
      `
    )
    .join("");
}

function renderSpots() {
  if (!els.spotsTbody) return;
  const rows = Array.isArray(state.activeSpots) ? state.activeSpots : [];
  if (rows.length === 0) {
    els.spotsTbody.innerHTML = `<tr class="empty-row"><td colspan="3">No active spots yet.</td></tr>`;
    return;
  }
  els.spotsTbody.innerHTML = rows
    .slice(0, 100)
    .map(
      (s) => `
          <tr>
            <td class="mono">${formatNumber(s.lat)}, ${formatNumber(s.lng)}</td>
            <td class="mono">${escapeHtml(s.userId)}</td>
            <td>${formatTimestamp(s.timestamp)}</td>
          </tr>
        `
    )
    .join("");
}

function renderReservedSpots() {
  if (!els.reservedSpotsTbody) return;
  const rows = Array.isArray(state.reservedSpots) ? state.reservedSpots : [];
  if (rows.length === 0) {
    els.reservedSpotsTbody.innerHTML = `<tr class="empty-row"><td colspan="4">No reserved spots yet.</td></tr>`;
    return;
  }
  els.reservedSpotsTbody.innerHTML = rows
    .slice(0, 100)
    .map(
      (s) => `
          <tr>
            <td class="mono">${formatNumber(s.lat)}, ${formatNumber(s.lng)}</td>
            <td class="mono">${escapeHtml(s.userId)}</td>
            <td class="mono">${escapeHtml(s.claimedBy == null ? "-" : String(s.claimedBy))}</td>
            <td>${formatTimestamp(s.timestamp)}</td>
          </tr>
        `
    )
    .join("");
}

function renderRevenue(data) {
  const panel = els.revenuePanel;
  if (!panel) return;
  panel.innerHTML = `
      <h3>Platform</h3>
      <p>💰 Platform Earned: €${Number(data.total_platform || 0).toFixed(2)}</p>
      <h3>Users</h3>
      <p>💸 Users Spent: €${Number(data.total_users_spent || 0).toFixed(2)}</p>
      <p>💰 Users Earned: €${Number(data.total_users_earned || 0).toFixed(2)}</p>
    `;
}

function updateOverview() {
  if (els.kpiUsers) els.kpiUsers.textContent = String(state.users.length);
  if (els.kpiSpots) els.kpiSpots.textContent = String(state.activeSpots.length);
  if (els.kpiReserved) els.kpiReserved.textContent = String(state.reservedSpots.length);
  if (els.kpiMarkers) els.kpiMarkers.textContent = String(Object.keys(state.spotMarkers).length);
  if (els.analyticsNote) {
    els.analyticsNote.textContent = state.nearestSpotId
      ? `Nearest visible spot ID: ${state.nearestSpotId}`
      : "Nearest visible spot ID: -";
  }
}

async function refreshDashboard() {
  let usersRes;
  let spotsRes;
  let usersData = {};
  let spotsData = {};
  let revenueData = {};
// Unified (single source of truth) function for spot marker creation using normalized coordinates.
// There should be ONLY ONE createSpotMarker function throughout admin.js.
// It must use normalizeSpotLatLng for extracting coordinates.
// All tag, debug, or coordinate swapping logic is removed to avoid duplication/inconsistency.

function createSpotMarker(spot) {
  // Ensure single source of truth for coordinates
  const pos = normalizeSpotLatLng(spot);
  if (!pos) {
    console.warn("[WARN] Spot does not have valid coordinates", spot);
    return null;
  }
  const lat = pos.lat;
  const lng = pos.lng;
  // Use consistent icon, fallback to admin's default
  const icon = (state && state.upostuIcon) || (typeof window !== "undefined" && window.upostuAdminDefaultIcon) || undefined;
  // Create marker at normalized coordinates
  const marker = L.marker([lat, lng], icon ? { icon } : undefined);
  marker.bindPopup(`<b>Spot ${spot.id != null ? spot.id : ""}</b><br>Lat: ${lat}<br>Lng: ${lng}`);
  return marker;
}

  // Default spot icon: same 40×40 square asset as initMap; center anchor + popup above center.
  if (typeof L !== "undefined" && L.icon) {
    window.upostuAdminDefaultIcon = L.icon({
      iconUrl: SPOT_ICON_URL,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -20],
      className: "upostu-marker"
    });
    // If using state to store custom icons
    if (typeof state === "object") {
      state.upostuIcon = window.upostuAdminDefaultIcon;
    }
  }
  // ------------------------------------------------------

  try {
    usersRes = await fetch(`${API_BASE}${API_PREFIX}/users`, { cache: "no-store" });
    usersData = await usersRes.json().catch(() => ({}));
  } catch (err) {
    console.error("API ERROR:", err);
    throw err;
  }
  try {
    spotsRes = await fetch(`${API_BASE}${API_PREFIX}/spots`, { cache: "no-store" });
    spotsData = await spotsRes.json().catch(() => ({}));
  } catch (err) {
    console.error("API ERROR:", err);
    throw err;
  }
  try {
    const revenueRes = await fetch(`${API_BASE}/admin/revenue`, { cache: "no-store" });
    revenueData = await revenueRes.json().catch(() => ({}));
  } catch (err) {
    console.error("API ERROR:", err);
    revenueData = {};
  }

  if (!usersRes.ok || !spotsRes.ok) throw new Error("Failed loading admin data");

  state.users = Array.isArray(usersData.users) ? usersData.users : [];
  const adminList = usersData.adminUsers || usersData.users || [];
  state.adminUsers = Array.isArray(adminList) ? adminList : [];
  state.activeSpots = Array.isArray(spotsData.activeSpots) ? spotsData.activeSpots : [];
  state.reservedSpots = Array.isArray(spotsData.reservedSpots) ? spotsData.reservedSpots : [];
  state.revenueData = revenueData;

  renderUsers(state.adminUsers);
  renderSpots();
  renderReservedSpots();
  renderRevenue(revenueData);
  updateUsers(state.users);
  updateSpots(spotsData);
  updateOverview();
  invalidateMapSoon();
}

async function loadAdminData() {
  try {
    await refreshDashboard();
  } catch (err) {
    console.error("ADMIN ERROR:", err);
    setLive("Error", "Failed loading admin data");
  }
}

function startPolling() {
  if (!state.wsConnected) setLive("HTTP", "Polling /api/users and /api/spots");
  if (state.pollTimer) clearInterval(state.pollTimer);
  loadAdminData();
  state.pollTimer = setInterval(() => {
    loadAdminData();
  }, POLL_INTERVAL_MS);
}

async function initializeDashboard() {
  if (els.reloadBtn) {
    els.reloadBtn.addEventListener("click", () => {
      location.reload();
    });
  }
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("isAdmin");
      window.location.href = "/admin-login";
    });
  }
  if (els.filterAll) els.filterAll.addEventListener("click", () => { state.currentFilter = "all"; loadAdminData(); });
  if (els.filterAvailable) els.filterAvailable.addEventListener("click", () => { state.currentFilter = "available"; loadAdminData(); });
  if (els.filterJustFreed) els.filterJustFreed.addEventListener("click", () => { state.currentFilter = "just_freed"; loadAdminData(); });
  if (els.filterCheapest) els.filterCheapest.addEventListener("click", () => { state.currentFilter = "cheapest"; loadAdminData(); });
  if (els.centerUser) {
    els.centerUser.addEventListener("click", () => {
      const u = state.users && state.users[0] ? state.users[0] : null;
      if (!u || !state.map) return;
      const lat = Number(u.lat);
      const lng = Number(u.lng);
      if (!isFinite(lat) || !isFinite(lng)) return;
      state.map.setView([lat, lng], 15);
    });
  }

  initSidebarNav();
  await initMap();
  connectSpotsWebSocket();
  connectAdminWebSocket();
  loadAdminData();
  startPolling();
  loadStats();
  invalidateMapSoon();
}

window.adminPanel = {
  loadUsers,
  loadUserDetail,
  loadWallet,
  loadStats,
};

document.addEventListener("DOMContentLoaded", () => {
  const isAdmin = localStorage.getItem("isAdmin");
  if (isAdmin !== "true") {
    window.location.href = "/admin-login";
    return;
  }
  initializeDashboard();
});
