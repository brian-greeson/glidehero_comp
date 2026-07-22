#!/usr/bin/env python3
"""Extract caption-free achievement artwork from the supplied 6x4 PNG sheet.

The source is intentionally not checked into ``public``: it contains baked
captions that must never be rendered by the application.  This script keeps
the extraction deterministic and dependency-free (Python standard library
only) so the generated PNGs can be reproduced when the source is available.
"""

from __future__ import annotations

import argparse
import struct
import subprocess
import zlib
from collections import deque
from pathlib import Path


SHEET_WIDTH = 1536
SHEET_HEIGHT = 1024
TILE_SIZE = 256
OUTPUT_SIZE = 256
MAX_ARTWORK_SIZE = 224
BACKGROUND_FLOOD_LIMIT = 72

# (column, row, artwork y-start, artwork y-end).  Captions sit between rows;
# these ranges deliberately exclude them while retaining the full illustration.
ROW_RANGES = ((0, 35, 242), (1, 300, 502), (2, 550, 735), (3, 778, 960))

# The names are stable presentation keys, not achievement catalog identifiers.
ASSETS = {
    "first-launch": (0, 0),
    "first-cell": (2, 0),
    "cell-explorer": (3, 0),
    "arenas-touched": (4, 0),
    "top-cell-holder": (5, 0),
    "eco-pilot": (0, 1),
    "distance-record": (1, 1),
    "duration-record": (2, 1),
    "altitude-record": (3, 1),
    "precision-pilot": (4, 1),
    "mapper": (3, 2),
    "streaker": (4, 2),
    "milestone": (5, 2),
    "community-player": (0, 3),
    "helpful-pilot": (1, 3),
    "photo-sharer": (2, 3),
    "legend": (3, 3),
    "champion": (4, 3),
    "collector": (5, 3),
}

# These laurel badges use a deliberately subtle shield face whose pixels are
# close to the sheet backdrop and whose outline is partly hidden by the wreath.
# Preserve the closed interior explicitly after clearing the external sheet.
CLOSED_SHIELDS = {
    "mapper": (112, 10, 43, 56),
    "streaker": (100, 10, 43, 56),
    "milestone": (90, 10, 43, 56),
    "legend": (110, 9, 57, 65),
}


def read_png(path: Path) -> tuple[int, int, bytes]:
    """Read an 8-bit RGB/RGBA, non-interlaced PNG using the stdlib."""

    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    offset = 8
    width = height = bit_depth = color_type = interlace = None
    idat = bytearray()
    while offset < len(raw):
        length = struct.unpack(">I", raw[offset : offset + 4])[0]
        kind = raw[offset + 4 : offset + 8]
        data = raw[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(
                ">IIBBBBB", data
            )
        elif kind == b"IDAT":
            idat.extend(data)
        elif kind == b"IEND":
            break
    if (width, height, bit_depth, interlace) != (SHEET_WIDTH, SHEET_HEIGHT, 8, 0):
        raise ValueError("expected a 1536x1024, 8-bit, non-interlaced PNG")
    if color_type not in (2, 6):
        raise ValueError("expected RGB or RGBA PNG")

    channels = 3 if color_type == 2 else 4
    stride = width * channels
    scanlines = zlib.decompress(idat)
    if len(scanlines) != height * (stride + 1):
        raise ValueError("unexpected PNG scanline length")
    pixels = bytearray(width * height * 3)
    previous = bytearray(stride)
    cursor = 0
    for y in range(height):
        filter_type = scanlines[cursor]
        cursor += 1
        current = bytearray(scanlines[cursor : cursor + stride])
        cursor += stride
        for i in range(stride):
            left = current[i - channels] if i >= channels else 0
            up = previous[i]
            upper_left = previous[i - channels] if i >= channels else 0
            if filter_type == 1:
                current[i] = (current[i] + left) & 255
            elif filter_type == 2:
                current[i] = (current[i] + up) & 255
            elif filter_type == 3:
                current[i] = (current[i] + ((left + up) // 2)) & 255
            elif filter_type == 4:
                estimate = left + up - upper_left
                pa = abs(estimate - left)
                pb = abs(estimate - up)
                pc = abs(estimate - upper_left)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else upper_left
                current[i] = (current[i] + predictor) & 255
            elif filter_type != 0:
                raise ValueError(f"unsupported PNG filter {filter_type}")
        for x in range(width):
            source = x * channels
            target = (y * width + x) * 3
            pixels[target : target + 3] = current[source : source + 3]
        previous = current
    return width, height, bytes(pixels)


def write_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    rows = b"".join(b"\0" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(rows, level=9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def build_alpha_matte(rgb: bytes, width: int, height: int) -> tuple[list[int], tuple[int, int, int]]:
    """Return a silhouette matte and the estimated local sheet background."""

    # The sheet backdrop is a dark blue-black gradient.  Bright icon rims and
    # enclosed dark interiors remain foreground; only border-connected backdrop
    # pixels are cleared.  A luminance threshold avoids keying dark badge cores.
    is_background = [
        max(rgb[i : i + 3]) <= BACKGROUND_FLOOD_LIMIT
        for i in range(0, len(rgb), 3)
    ]
    # Bright/colored artwork forms the flood barrier. Partly occluded shield
    # faces are restored later with explicit closed silhouettes.
    barrier = bytearray(not candidate for candidate in is_background)
    guarded = barrier

    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if is_background[index] and not guarded[index] and not visited[index]:
            visited[index] = 1
            queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)
    while queue:
        x, y = queue.popleft()
        # Four-way connectivity keeps enclosed dark badge interiors opaque;
        # diagonal-only paths across antialiased rims must not flood them.
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height:
                enqueue(nx, ny)
    alpha = [255 if not visited[i] else 0 for i in range(width * height)]

    # Estimate the local sheet color from cleared border-connected pixels.  A
    # one-pixel soft fringe restores antialiasing/shadow without reintroducing
    # the broad rectangular backdrop that the source bakes around each badge.
    background_pixels = [
        tuple(rgb[i * 3 : i * 3 + 3])
        for i in range(width * height)
        if visited[i] and max(rgb[i * 3 : i * 3 + 3]) <= 36
    ]
    background = tuple(
        sorted(pixel[channel] for pixel in background_pixels)[len(background_pixels) // 2]
        for channel in range(3)
    )
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index] or not is_background[index]:
                continue
            near_outside = any(
                0 <= x + dx < width
                and 0 <= y + dy < height
                and visited[(y + dy) * width + x + dx]
                for dy in range(-3, 4)
                for dx in range(-3, 4)
            )
            if not near_outside:
                continue
            pixel = rgb[index * 3 : index * 3 + 3]
            distance = max(abs(pixel[channel] - background[channel]) for channel in range(3))
            alpha[index] = max(0, min(160, (distance - 2) * 8))
    soft_alpha = alpha.copy()
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if not visited[index]:
                continue
            touches_subject = any(
                0 <= x + dx < width
                and 0 <= y + dy < height
                and alpha[(y + dy) * width + x + dx] == 255
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))
            )
            if not touches_subject:
                continue
            pixel = rgb[index * 3 : index * 3 + 3]
            distance = max(abs(pixel[channel] - background[channel]) for channel in range(3))
            soft_alpha[index] = max(0, min(160, (distance - 2) * 8))
    return soft_alpha, background


def resize_rgba(source: bytes, width: int, height: int, target_width: int, target_height: int) -> bytes:
    """Bilinearly resize a small RGBA image without external dependencies."""

    if (width, height) == (target_width, target_height):
        return source
    output = bytearray(target_width * target_height * 4)
    for y in range(target_height):
        source_y = (y + 0.5) * height / target_height - 0.5
        y0 = max(0, min(height - 1, int(source_y)))
        y1 = min(height - 1, y0 + 1)
        fy = source_y - int(source_y)
        for x in range(target_width):
            source_x = (x + 0.5) * width / target_width - 0.5
            x0 = max(0, min(width - 1, int(source_x)))
            x1 = min(width - 1, x0 + 1)
            fx = source_x - int(source_x)
            for channel in range(4):
                a = source[(y0 * width + x0) * 4 + channel]
                b = source[(y0 * width + x1) * 4 + channel]
                c = source[(y1 * width + x0) * 4 + channel]
                d = source[(y1 * width + x1) * 4 + channel]
                value = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
                output[(y * target_width + x) * 4 + channel] = max(0, min(255, round(value)))
    return bytes(output)


def point_in_polygon(x: float, y: float, polygon: tuple[tuple[int, int], ...]) -> bool:
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y):
            crossing = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing:
                inside = not inside
        previous = current
    return inside


def extract_icon(sheet: bytes, name: str, column: int, row: int) -> bytes:
    y_start, y_end = ROW_RANGES[row][1:]
    x_start = column * TILE_SIZE
    crop_width = TILE_SIZE
    crop_height = y_end - y_start
    crop_rgb = bytearray(crop_width * crop_height * 3)
    for y in range(crop_height):
        source_start = ((y_start + y) * SHEET_WIDTH + x_start) * 3
        target_start = y * crop_width * 3
        crop_rgb[target_start : target_start + crop_width * 3] = sheet[
            source_start : source_start + crop_width * 3
        ]
    alpha, background = build_alpha_matte(bytes(crop_rgb), crop_width, crop_height)
    if name in CLOSED_SHIELDS:
        center_x, top, half_top, half_side = CLOSED_SHIELDS[name]
        polygon = (
            (center_x, top),
            (center_x + half_top, top + 11),
            (center_x + half_side, top + 35),
            (center_x + half_side - 3, top + 116),
            (center_x + 38, top + 140),
            (center_x, top + 158),
            (center_x - 38, top + 140),
            (center_x - half_side + 3, top + 116),
            (center_x - half_side, top + 35),
            (center_x - half_top, top + 11),
        )
        for y in range(crop_height):
            for x in range(crop_width):
                if point_in_polygon(x + 0.5, y + 0.5, polygon):
                    alpha[y * crop_width + x] = 255
    points = [(x, y) for y in range(crop_height) for x in range(crop_width) if alpha[y * crop_width + x]]
    if not points:
        raise ValueError(f"no artwork found for column={column}, row={row}")
    min_x = min(x for x, _ in points)
    max_x = max(x for x, _ in points)
    min_y = min(y for _, y in points)
    max_y = max(y for _, y in points)
    width = max_x - min_x + 1
    height = max_y - min_y + 1
    tight = bytearray(width * height * 4)
    for y in range(height):
        for x in range(width):
            source_x, source_y = min_x + x, min_y + y
            source_index = (source_y * crop_width + source_x) * 3
            target_index = (y * width + x) * 4
            pixel_alpha = alpha[source_y * crop_width + source_x]
            if 0 < pixel_alpha < 255:
                fraction = pixel_alpha / 255
                for channel in range(3):
                    composite = crop_rgb[source_index + channel]
                    foreground = round((composite - (1 - fraction) * background[channel]) / fraction)
                    tight[target_index + channel] = max(0, min(255, foreground))
            else:
                tight[target_index : target_index + 3] = crop_rgb[source_index : source_index + 3]
            tight[target_index + 3] = pixel_alpha
    scale = min(1.0, MAX_ARTWORK_SIZE / max(width, height))
    scaled_width = max(1, round(width * scale))
    scaled_height = max(1, round(height * scale))
    scaled = resize_rgba(bytes(tight), width, height, scaled_width, scaled_height)
    canvas = bytearray(OUTPUT_SIZE * OUTPUT_SIZE * 4)
    left = (OUTPUT_SIZE - scaled_width) // 2
    top = (OUTPUT_SIZE - scaled_height) // 2
    for y in range(scaled_height):
        source_start = y * scaled_width * 4
        target_start = ((top + y) * OUTPUT_SIZE + left) * 4
        canvas[target_start : target_start + scaled_width * 4] = scaled[source_start : source_start + scaled_width * 4]
    return bytes(canvas)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="1536x1024 source PNG")
    parser.add_argument("--output", type=Path, default=Path("public/images/app-ui/achievements"))
    args = parser.parse_args()
    width, height, sheet = read_png(args.source)
    if (width, height) != (SHEET_WIDTH, SHEET_HEIGHT):
        raise ValueError("source dimensions must be exactly 1536x1024")
    args.output.mkdir(parents=True, exist_ok=True)
    for name, (column, row) in ASSETS.items():
        output = args.output / f"{name}.png"
        write_png(output, OUTPUT_SIZE, OUTPUT_SIZE, extract_icon(sheet, name, column, row))
        print(output)


if __name__ == "__main__":
    main()
