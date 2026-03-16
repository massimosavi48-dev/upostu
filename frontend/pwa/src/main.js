console.log("MAIN JS LOADED")
const map = L.map("map").setView([38.1157, 13.3615], 13);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(map);

const locateBtn = document.getElementById("locate-btn");

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported in this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      map.setView([latitude, longitude], 16);
      L.marker([latitude, longitude]).addTo(map).bindPopup("You are here").openPopup();
    },
    () => {
      alert("Unable to get your location.");
    },
  );
});

