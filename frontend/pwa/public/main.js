const API_BASE = "http://localhost:8000";
const WS_URL = "wss://upostu.it/api/ws";

// Safety cleanup: unregister any existing service workers (prevents stale cached assets).
if ("serviceWorker" in navigator) {
 navigator.serviceWorker.getRegistrations()
  .then((regs) => Promise.all(regs.map((r) => r.unregister())))
  .then(() => console.log("Service Worker(s) unregistered"))
  .catch((e) => console.warn("Service Worker unregister failed:", e));
}

/* MAPPA */

window.addEventListener("DOMContentLoaded", () => {
 console.log("main.js executing");
 console.log("DOMContentLoaded");

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

const markers = L.markerClusterGroup();
map.addLayer(markers);


/* MARKER UTENTE ARRIVO */

let incomingUserMarker = null;


/* WEBSOCKET */

let socket = null;
try {
 socket = new WebSocket(WS_URL);
 console.log("WS init", WS_URL);
} catch (e) {
 console.warn("WS init failed:", e);
}

if (socket) {
 socket.onopen = () => console.log("WS connected");
 socket.onerror = (e) => console.warn("WS error", e);
 socket.onclose = () => console.warn("WS closed");
 socket.onmessage = (event)=>{

 let message;
 try {
  message = JSON.parse(event.data);
 } catch (e) {
  console.warn("WS message parse failed:", e, event.data);
  return;
 }

 if(message.event==="parking_spot_created"){

  const marker=createMarker(message.data);
  markers.addLayer(marker);

 }

 if(message.event==="user_location"){

  const user = message.data;

  if(!incomingUserMarker){

   incomingUserMarker=L.marker([user.latitude,user.longitude]).addTo(map);

  }else{

   incomingUserMarker.setLatLng([user.latitude,user.longitude]);

  }

  updateArrivalInfo(user.latitude,user.longitude);

 }

 };
}


/* CREA MARKER */

function createMarker(spot){

 const marker=L.marker([spot.latitude,spot.longitude]);

 const popup=`
 <div style="text-align:center">
 <b>Parking Spot</b><br><br>
 <button onclick="reserveSpot(${spot.id})">
 Prenota questo posto
 </button>
 </div>
 `;

 marker.bindPopup(popup);

 return marker;

}


/* CARICA PARCHEGGI */

async function loadParkingSpots(){

 const res=await fetch(`${API_BASE}/parking`);

 const spots=await res.json();

 markers.clearLayers();

 spots.forEach(spot=>{

  const marker=createMarker(spot);

  markers.addLayer(marker);

 });

}


/* GPS */

let userLat=null;
let userLng=null;

function getUserLocation(){

 if (!navigator.geolocation) return;
 navigator.geolocation.getCurrentPosition(pos=>{

  userLat=pos.coords.latitude;
  userLng=pos.coords.longitude;

  map.setView([userLat,userLng],16);

  L.marker([userLat,userLng])
   .bindPopup("You are here")
   .addTo(map)
   .openPopup();

 }, () => {});

}


/* INVIO POSIZIONE */

function sendLocation(){

 if(!userLat||!userLng) return;
 if (!socket || socket.readyState !== WebSocket.OPEN) return;

 try {
  socket.send(JSON.stringify({

  event:"user_location",

  data:{
   latitude:userLat,
   longitude:userLng
  }

  }));
 } catch (e) {
  console.warn("WS send failed:", e);
 }

}


setInterval(()=>{

 if (!navigator.geolocation) return;
 navigator.geolocation.getCurrentPosition(pos=>{

  userLat=pos.coords.latitude;
  userLng=pos.coords.longitude;

  sendLocation();

 }, () => {});

},3000);


/* LASCIO POSTO */

const leaveBtn = document.getElementById("leave-btn");
if (!leaveBtn) {
 console.warn('BUTTON MISSING: "leave-btn"');
} else leaveBtn.onclick=async()=>{

 if(!userLat) return;

 const res=await fetch(`${API_BASE}/parking`,{

  method:"POST",

  headers:{
   "Content-Type":"application/json"
  },

  body:JSON.stringify({
   latitude:userLat,
   longitude:userLng
  })

 });

 const spot=await res.json();

 markers.addLayer(createMarker(spot));

};


/* CERCO POSTO */

const findBtn = document.getElementById("find-btn");
if (!findBtn) {
 console.warn('BUTTON MISSING: "find-btn"');
} else findBtn.onclick=async()=>{

 const res=await fetch(`${API_BASE}/parking/nearby?lat=${userLat}&lng=${userLng}`);

 const spots=await res.json();

 markers.clearLayers();

 spots.forEach(s=>{

  markers.addLayer(createMarker(s));

 });

};


/* PRENOTA */

async function reserveSpot(id){

 await fetch(`${API_BASE}/parking/reserve`,{

  method:"POST",

  headers:{
   "Content-Type":"application/json"
  },

  body:JSON.stringify({spot_id:id})

 });

 alert("Parcheggio prenotato");

 startTimer();

 loadParkingSpots();

}


/* TIMER */

function startTimer(){

 let time=120;

 const timer=setInterval(()=>{

  time--;

  if(time<=0){

   clearInterval(timer);

   alert("Prenotazione scaduta");

   loadParkingSpots();

  }

 },1000);

}


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

loadParkingSpots();

getUserLocation();
});