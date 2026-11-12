"""本地小服务器：找一个空闲端口，打开浏览器，提供本项目的静态文件。

用法：python build/serve.py [端口]
（start.bat 会调用它；等价于 python -m http.server，只是会自动换端口、自动开浏览器）
"""
import functools
import http.server
import mimetypes
import socket
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")


def free_port(start: int) -> int:
    for p in range(start, start + 50):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise SystemExit("找不到空闲端口")


def main():
    nums = [a for a in sys.argv[1:] if a.isdigit()]
    port = free_port(int(nums[0]) if nums else 8765)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://localhost:{port}/"
    print(f"\n  已启动：{url}\n  用完关掉这个窗口即可。\n")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
