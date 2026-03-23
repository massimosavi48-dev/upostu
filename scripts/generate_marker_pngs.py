"""One-off: generate simple solid-color marker PNGs for Leaflet (stdlib only)."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path


def _chunk(chunk_type: bytes, data: bytes) -> bytes:
    chunk = chunk_type + data
    crc = zlib.crc32(chunk) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", crc)


def write_solid_png(path: Path, width: int, height: int, rgb: tuple[int, int, int]) -> None:
    r, g, b = rgb
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b""
    scan = b"\x00" + bytes([r, g, b]) * width
    for _ in range(height):
        raw += scan
    compressed = zlib.compress(raw, 9)
    png = signature + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", compressed) + _chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "frontend" / "pwa" / "public" / "markers"
    root.mkdir(parents=True, exist_ok=True)
    colors = {
        "yellow.png": (234, 179, 8),
        "green.png": (34, 197, 94),
        "orange.png": (249, 115, 22),
        "blue.png": (59, 130, 246),
        "red.png": (239, 68, 68),
    }
    for name, rgb in colors.items():
        write_solid_png(root / name, 40, 40, rgb)
    print("OK:", root, list(colors.keys()))


if __name__ == "__main__":
    main()
