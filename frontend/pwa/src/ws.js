const WS_URL = "wss://upostu.it/api/ws";

let socket = null;

export function connectWebSocket() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log("✅ WebSocket connesso");
    };

    socket.onmessage = (event) => {
        console.log("📩 Messaggio ricevuto:", event.data);
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