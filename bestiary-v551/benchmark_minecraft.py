#!/usr/bin/env python3
"""Actual Minecraft 1.21.1 client startup/world-load/memory benchmark.

The benchmark MUST join a world and run with the real published SVFrame Lite
manifest. An alive Java PID is not a passing benchmark. Mesa llvmpipe is a
software GPU: numbers are environment-specific, NOT hardware FPS claims.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import uuid

import minecraft_launcher_lib as mll
import psutil

ROOT = Path(os.environ.get("BENCH_ROOT", "/tmp/svframe-551-game-bench"))
GAME = ROOT / "client"
REPORTS = Path(os.environ.get("BENCH_REPORT", "benchmark-output"))
PROFILE = os.environ.get("BENCH_PROFILE", "lite")
MC = "1.21.1"
LOADER = "0.18.4"
MANIFEST_URL = ("https://raw.githubusercontent.com/aristheg201/bestiary-distribution/"
                "main/bestiary-distribution/releases/1.6.29-official/manifest.json")
DOWNLOAD_TIMEOUT = 65
MAX_DOWNLOAD_ATTEMPTS = 4
PASS_STABILITY_SECONDS = 30
WORLD_BOOT_TIMEOUT = 260
SERVER_GEN_TIMEOUT = 180


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "SVFrame-QA/5.5.1",
         "Accept": "application/json,application/octet-stream"}), timeout=DOWNLOAD_TIMEOUT) as r:
        return r.read()


def download(entry):
    relative = entry["path"].replace("\\", "/")
    parts = relative.split("/")
    if len(parts) < 2 or any(x in (".", "..", "") for x in parts):
        raise RuntimeError("Unsafe manifest path: " + relative)
    destination = GAME.joinpath(*parts)
    resolved = destination.resolve()
    if not resolved.is_relative_to(GAME.resolve()):
        raise RuntimeError("Escaping game directory: " + relative)
    expected = entry["hash"].lower()
    if not len(expected) == 64 or not all(x in "0123456789abcdef" for x in expected):
        raise RuntimeError("Invalid SHA256 for " + relative)
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
        return relative
    for attempt in range(MAX_DOWNLOAD_ATTEMPTS):
        try:
            data = fetch(entry["downloadUrl"])
            if hashlib.sha256(data).hexdigest() != expected:
                raise RuntimeError("Hash mismatch: " + relative)
            destination.parent.mkdir(parents=True, exist_ok=True)
            tmp = destination.with_suffix(destination.suffix + ".partial")
            tmp.write_bytes(data)
            tmp.replace(destination)
            return relative
        except Exception:
            if attempt == MAX_DOWNLOAD_ATTEMPTS - 1:
                raise
            time.sleep(2 ** attempt)


def seed_test_world(metadata):
    server_url = metadata["downloads"]["server"]["url"]
    expected = metadata["downloads"]["server"]["sha1"]
    server_dir = ROOT / "server"
    server_dir.mkdir(parents=True, exist_ok=True)
    server_jar = server_dir / "server.jar"
    data = fetch(server_url)
    if hashlib.sha1(data).hexdigest() != expected:
        raise RuntimeError("Vanilla server JAR SHA1 mismatch")
    server_jar.write_bytes(data)
    (server_dir / "eula.txt").write_text("eula=true\n")
    (server_dir / "server.properties").write_text(
        "online-mode=false\nlevel-name=qa_world\nlevel-seed=20261107\n"
        "spawn-protection=0\nview-distance=4\nsimulation-distance=4\n"
        "max-players=1\ngenerate-structures=false\n", encoding="utf8")
    print("Generating deterministic test world with real Minecraft server...", flush=True)
    handle = subprocess.Popen(["java", "-Xms512M", "-Xmx2048M", "-jar", "server.jar", "nogui"],
        cwd=server_dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        bufsize=1)
    try:
        ready = False
        deadline = time.monotonic() + SERVER_GEN_TIMEOUT
        while time.monotonic() < deadline:
            line = handle.stdout.readline()
            if line:
                print("WORLDGEN " + line.rstrip()[:200], flush=True)
                if "Done (" in line and "For help" in line:
                    ready = True
                    break
            elif handle.poll() is not None:
                break
        if not ready:
            raise RuntimeError("Server never generated a ready world")
    finally:
        handle.terminate()
        try:
            handle.wait(timeout=15)
        except subprocess.TimeoutExpired:
            handle.kill()
            handle.wait(timeout=10)
    world = server_dir / "qa_world"
    if not (world / "level.dat").is_file():
        raise RuntimeError("Server failed to create real level.dat")
    target = GAME / "saves" / "qa_world"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(world, target)
    return target


def game_process_metrics(handle):
    parent = psutil.Process(handle.pid)
    try:
        descendants = [parent] + parent.children(recursive=True)
        rss = sum(x.memory_info().rss for x in descendants if x.is_running())
        cpu = sum(x.cpu_percent(interval=None) for x in descendants if x.is_running())
        return rss / (1024 ** 2), cpu
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return 0.0, 0.0


def launch_case(name, command_version, game_dir):
    case_dir = REPORTS / name
    case_dir.mkdir(parents=True, exist_ok=True)
    flags = [
        "--quickPlaySingleplayer", "qa_world",
        "--quickPlayPath", "qa/quickplay.log",
        "--width", "1024", "--height", "768",
    ]
    opt = mll.utils.generate_test_options()
    opt.update({
        "username": "SVFrameQA551",
        "uuid": str(uuid.uuid4()),
        "executablePath": "java",
        "jvmArguments": ["-Xms512M", "-Xmx4096M", "-Djava.awt.headless=false"],
        "gameDirectory": str(game_dir),
        "customResolution": True,
        "resolutionWidth": "1024",
        "resolutionHeight": "768",
    })
    cmd = mll.command.get_minecraft_command(command_version, str(game_dir), opt)
    cmd.extend(flags)
    env = os.environ.copy()
    env["LIBGL_ALWAYS_SOFTWARE"] = "1"
    env["MESA_GL_VERSION_OVERRIDE"] = "4.5"
    env["GALLIUM_DRIVER"] = "llvmpipe"
    env["JAVA_TOOL_OPTIONS"] = "-Dfile.encoding=UTF-8"
    quicklog = game_dir / "qa" / "quickplay.log"
    quicklog.parent.mkdir(parents=True, exist_ok=True)
    if quicklog.exists():
        quicklog.unlink()
    output = case_dir / "client-console.log"
    started = time.monotonic()
    with output.open("w", encoding="utf8") as out:
        handle = subprocess.Popen(cmd, cwd=game_dir, env=env, stdout=out,
                                  stderr=subprocess.STDOUT, start_new_session=True)
        samples = []
        joined_at = None
        survived = False
        process_failure = None
        try:
            deadline = started + WORLD_BOOT_TIMEOUT
            while time.monotonic() < deadline:
                if handle.poll() is not None:
                    process_failure = "Minecraft exited " + str(handle.returncode)
                    break
                if quicklog.exists() and quicklog.stat().st_size:
                    data = quicklog.read_text(encoding="utf8", errors="replace")
                    if "singleplayer" in data and "qa_world" in data:
                        joined_at = time.monotonic()
                        print("QA IN-GAME JOINED:", name, "in", round(joined_at-started, 2), "sec", flush=True)
                        break
                time.sleep(2)
            if joined_at is None:
                raise RuntimeError(process_failure or "Minecraft did not report Quick Play world entry")
            for step in range(PASS_STABILITY_SECONDS // 2):
                if handle.poll() is not None:
                    raise RuntimeError("Minecraft terminated after joining world")
                rss, cpu = game_process_metrics(handle)
                samples.append({"seconds": step * 2, "rss_mb": round(rss, 2),
                                "cpu_percent": round(cpu, 2)})
                time.sleep(2)
            survived = True
        finally:
            try:
                os.killpg(handle.pid, signal.SIGTERM)
                handle.wait(timeout=12)
            except Exception:
                try:
                    os.killpg(handle.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
    log_text = output.read_text(encoding="utf8", errors="replace")
    error_markers = ["Failed to find any valid GLFW profile", "GLFW error: [0x10006]",
                     "The driver does not appear to support OpenGL", "Mixin apply failed",
                     "Could not find required mod"]
    observed = [mark for mark in error_markers if mark.lower() in log_text.lower()]
    result = {
        "case": name, "minecraft": MC, "version_id": command_version,
        "renderer": "Mesa llvmpipe (software), Ubuntu Xvfb",
        "game_joined": bool(joined_at), "stable_30s": survived,
        "time_to_world_seconds": round(joined_at - started, 2) if joined_at else None,
        "peak_rss_mb": round(max((s["rss_mb"] for s in samples), default=0), 2),
        "rss_samples": samples, "fatal_log_markers": observed,
        "fps": None, "fps_note": "FPS not recorded: no reliable rendered-frame counter; not a GPU hardware benchmark",
    }
    (case_dir / "benchmark.json").write_text(json.dumps(result, indent=2), encoding="utf8")
    print("BENCHMARK " + json.dumps({k: v for k,v in result.items() if k!="rss_samples"}), flush=True)
    if observed:
        raise RuntimeError("Critical Minecraft render/mod errors: " + ", ".join(observed))
    if not survived:
        raise RuntimeError("No stable world run")
    return result


def main():
    REPORTS.mkdir(parents=True, exist_ok=True)
    GAME.mkdir(parents=True, exist_ok=True)
    print("=== Real Minecraft 1.21.1 SVFrame Lite benchmark on software Mesa ===", flush=True)
    print("Installing genuine Mojang client and Fabric 0.18.4", flush=True)
    mll.install.install_minecraft_version(MC, str(GAME))
    installed = mll.mod_loader.get_mod_loader("fabric").install(
        MC, str(GAME), loader_version=LOADER)
    # Minecraft data version 3955. A missing version causes options.txt
    # to reset on first load and invalidates keybind first-run assertions.
    (GAME / "options.txt").write_text(
        "version:3955\nrenderDistance:6\nsimulationDistance:5\n"
        "maxFps:60\nparticles:2\ngraphicsMode:0\n"
        "key_key.inventory:key.keyboard.i\n",
        encoding="utf8")
    meta = json.loads((GAME / "versions" / MC / (MC + ".json")).read_text(encoding="utf8"))
    seed_test_world(meta)
    manifest = json.loads(fetch(MANIFEST_URL))
    if not manifest.get("version") == "1.6.29-official":
        raise RuntimeError("Unexpected distribution version; benchmark is not reproducibly pinned")
    selected = [f for f in manifest["files"] if PROFILE in f.get("profiles", [])
                and f.get("path", "").startswith(("mods/", "config/", "resourcepacks/"))]
    if len(selected) < 100:
        raise RuntimeError("Incomplete SVFrame Lite manifest, refusing benchmark")
    print("Verified distribution manifest: " + str(len(selected)) + " files, profile " + PROFILE, flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(download, entry) for entry in selected]
        for idx, f in enumerate(concurrent.futures.as_completed(futures), 1):
            f.result()
            if idx % 20 == 0 or idx == len(futures):
                print("Verified real SHA256 objects:", idx, "/", len(futures), flush=True)
    result = launch_case("SVFrame-Official-Lite", installed, GAME)
    (REPORTS / "report.json").write_text(json.dumps({
        "version": "5.5.1", "distribution": manifest["version"],
        "file_count": len(selected), "profile": PROFILE,
        "test_kind": "real_Minecraft_client_world_load_software_GPU",
        "results": [result]
    }, indent=2), encoding="utf8")
    print("QA PASS: Full SVFrame Official Lite launched Minecraft 1.21.1 with Mesa, entered world, stable 30s", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        REPORTS.mkdir(parents=True, exist_ok=True)
        (REPORTS / "failure.txt").write_text(repr(exc) + "\n", encoding="utf8")
        print("QA FAIL: real SVFrame Minecraft benchmark: " + repr(exc), file=sys.stderr, flush=True)
        sys.exit(1)
