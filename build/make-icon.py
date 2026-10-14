"""把 build/icon-<n>.png 打包成 build/icon.ico（多尺寸，供 Windows 使用）。
用法：python build/make-icon.py
"""
import os
import struct

BUILD = os.path.dirname(os.path.abspath(__file__))
SIZES = [16, 24, 32, 48, 64, 128, 256]


def png_bytes(size):
    path = os.path.join(BUILD, f"icon-{size}.png")
    with open(path, "rb") as f:
        return f.read()


def build_ico(entries, out_path):
    # entries: list of (size, png_data). 全部用 PNG 编码（Vista+ 支持）
    count = len(entries)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + count * 16
    dir_entries = b""
    data = b""
    for size, blob in entries:
        w = 0 if size >= 256 else size
        h = 0 if size >= 256 else size
        dir_entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
        data += blob
    with open(out_path, "wb") as f:
        f.write(header + dir_entries + data)


if __name__ == "__main__":
    from PIL import Image

    missing = [s for s in SIZES if not os.path.exists(os.path.join(BUILD, f"icon-{s}.png"))]
    if missing:
        src = Image.open(os.path.join(BUILD, "icon.png"))
        for s in missing:
            src.resize((s, s), Image.LANCZOS).save(os.path.join(BUILD, f"icon-{s}.png"))

    entries = [(s, png_bytes(s)) for s in SIZES]
    out = os.path.join(BUILD, "icon.ico")
    build_ico(entries, out)
    print("icon.ico ->", out, os.path.getsize(out), "bytes")
