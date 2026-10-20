#!/usr/bin/env python3
"""Download wheels from PyPI and install them into a venv (no index, no deps).

The sandbox's pip cannot reach the CDN directly, but plain HTTPS to
files.pythonhosted.org works, so we resolve the wheel URLs through the PyPI
JSON API and install the files by hand.

    python3 dev/training/fetch_wheels.py torch onnxruntime ml_dtypes ...
"""
import json
import os
import subprocess
import sys
import urllib.request

WHEELS = "/tmp/wheels"
VENV = "/workspace/venv"


def pick(pkg, prefer=()):
    d = json.load(urllib.request.urlopen(f"https://pypi.org/pypi/{pkg}/json", timeout=60))
    # Newest first, but skip versions that do not support this Python.
    def vkey(v):
        return [int(x) if x.isdigit() else 0 for x in v.replace("-", ".").split(".")[:3]]
    versions = sorted(d["releases"].keys(), key=vkey, reverse=True)
    for ver in versions:
        files = d["releases"][ver]
        if not files:
            continue
        for f in files:
            if f["packagetype"] != "bdist_wheel":
                continue
            rp = f.get("requires_python") or ""
            if rp and "3.11" not in rp and ">=3.12" in rp:
                continue
            fn = f["filename"]
            if "x86_64" in fn and "musl" in fn:
                continue
            if any(w in fn for w in ("linux_arm", "aarch64", "ppc64", "s390x", "macosx", "win_", "win32")):
                continue
            if not any(t in fn for t in ("cp311", "abi3", "py3", "py2.py3")):
                continue
            if prefer and not any(w in fn for w in prefer):
                continue
            if prefer and "cpu" not in fn:
                continue
            return f
    return None


def main():
    os.makedirs(WHEELS, exist_ok=True)
    paths = []
    for pkg in sys.argv[1:]:
        prefer = ("+cpu",) if pkg == "torch" else ()
        f = pick(pkg, prefer)
        if not f:
            print(f"  !! no wheel for {pkg}")
            continue
        out = os.path.join(WHEELS, f["filename"])
        if not os.path.exists(out):
            print(f"  downloading {f['filename']} ({f['size']//1024} KB)", flush=True)
            urllib.request.urlretrieve(f["url"], out)
        paths.append(out)
    cmd = [f"{VENV}/bin/pip", "install", "--no-index", "--no-deps"] + paths
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout[-1200:])
    if r.returncode:
        print(r.stderr[-1200:])
        sys.exit(1)


if __name__ == "__main__":
    main()
