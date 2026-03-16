from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services.parking_service import manager


router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
  await manager.connect(websocket)
  try:
    while True:
      # Keep the connection open; we don't expect messages from clients for now
      await websocket.receive_text()
  except WebSocketDisconnect:
    manager.disconnect(websocket)

