// UNUSED FILE - NOT USED BY APP
// Legacy WS helper for `src/main.UNUSED.js` only.

const WS_URL = "ws://localhost:8000/api/ws";

let socket = null;

export function connectWebSocket() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log("✅ WebSocket connesso");
    };

    socket.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.warn("WS message parse failed:", e, event.data);
            return;
        }
        handleWSMessage(data);
    };

    socket.onclose = () => {
        console.log("❌ WebSocket chiuso");
    };

    socket.onerror = (error) => {
        console.error("⚠️ Errore WebSocket:", error);
    };
}

export function sendMessage(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    } else {
        console.warn("WebSocket non connesso");
    }
}