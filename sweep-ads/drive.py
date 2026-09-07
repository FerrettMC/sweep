#!/usr/bin/env python3
"""drive.py — script the app on a plugged-in phone.

    ./drive.py run demos/search.json     run a whole demo
    ./drive.py tap "Search"              one step at a time, for working it out
    ./drive.py type "airpods pro"
    ./drive.py shot 01
    ./drive.py ls                        what's on screen right now

Elements are found by their text, not by coordinates. Sweep's UI exposes proper
labels, so "tap the thing that says Search" keeps working when the layout moves,
a different phone is plugged in, or the font scale changes. Hardcoded taps break
on all three and break silently, which is worse: you get a video of the wrong
screen and don't notice until you're editing it.
"""
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).parent
DUMP = "/sdcard/sweep-ui.xml"

# Set by demo_mode(), read by shot(). A notification arriving mid-run puts its
# icon back in the status bar, so the suppression has to be re-sent per capture
# rather than once at the start.
_demo_on = False


def adb(*args: str, timeout: int = 30) -> str:
    result = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise SystemExit(f"adb {' '.join(args[:3])} failed: {result.stderr.strip()}")
    return result.stdout


def require_device() -> None:
    if "device" not in adb("get-state"):
        raise SystemExit("No device. Plug the phone in and unlock it.")


def dump() -> list[dict]:
    """Every labelled node on screen, with its centre point."""
    adb("shell", "uiautomator", "dump", DUMP)
    xml = adb("shell", "cat", DUMP)
    nodes = []
    for element in ET.fromstring(xml).iter("node"):
        label = (element.get("text") or "").strip() or (element.get("content-desc") or "").strip()
        if not label:
            continue
        box = re.findall(r"-?\d+", element.get("bounds", ""))
        if len(box) != 4:
            continue
        x1, y1, x2, y2 = (int(v) for v in box)
        nodes.append({
            "label": label,
            "clickable": element.get("clickable") == "true",
            "x": (x1 + x2) // 2,
            "y": (y1 + y2) // 2,
            "height": y2 - y1,
        })
    return nodes


def find(text: str, nodes: list[dict] | None = None) -> dict | None:
    """First clickable node containing `text`, falling back to any node.

    Clickable first because a label and its container both match, and tapping
    the container is what actually does something. The zero-height filter drops
    nodes scrolled off screen, which report bounds but cannot be tapped.
    """
    nodes = nodes if nodes is not None else dump()
    needle = text.lower()
    hits = [n for n in nodes if needle in n["label"].lower() and n["height"] > 0]
    if not hits:
        return None
    clickable = [n for n in hits if n["clickable"]]
    return clickable[0] if clickable else hits[0]


def tap(text: str) -> None:
    node = find(text)
    if not node:
        raise SystemExit(f"Nothing on screen matching {text!r}. Try: ./drive.py ls")
    adb("shell", "input", "tap", str(node["x"]), str(node["y"]))
    print(f"tapped {node['label'][:48]!r} at {node['x']},{node['y']}")


def type_text(text: str) -> None:
    # `input text` treats a space as an argument separator, so it wants %s.
    # Everything else here is a character adb's own shell would eat first.
    escaped = text.replace(" ", "%s")
    for char, replacement in [("'", r"\'"), ('"', r'\"'), ("&", r"\&"), ("(", r"\("), (")", r"\)")]:
        escaped = escaped.replace(char, replacement)
    adb("shell", "input", "text", escaped)
    print(f"typed {text!r}")


def wait_for(text: str, timeout: float = 30.0) -> None:
    """Poll until something matching appears. This is what makes it reliable.

    A fixed sleep is a guess about how long a search takes, and a search that
    hits five stores does not take a predictable time. Guessing low records the
    spinner; guessing high wastes footage.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        if find(text):
            print(f"saw {text!r} after {timeout - (deadline - time.time()):.1f}s")
            return
        time.sleep(0.7)
    raise SystemExit(f"Timed out after {timeout}s waiting for {text!r}")


def shot(name: str) -> None:
    if _demo_on:
        # A Discord or Snapchat notification landing mid-run puts its icon back
        # in the status bar. Re-sending costs nothing and is the difference
        # between usable footage and a reshoot.
        broadcast = ["shell", "am", "broadcast", "-a", "com.android.systemui.demo"]
        adb(*broadcast, "-e", "command", "notifications", "-e", "visible", "false")
        time.sleep(0.3)

    (HERE / "shots").mkdir(exist_ok=True)
    path = HERE / "shots" / f"{name}.png"
    with open(path, "wb") as f:
        # exec-out, not shell, or the PNG gets line-ending mangled.
        result = subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=f)
    if result.returncode != 0 or path.stat().st_size == 0:
        raise SystemExit("screencap failed")
    print(f"shots/{name}.png  ({path.stat().st_size // 1024} KB)")


def hide_keyboard() -> None:
    """Dismiss the soft keyboard.

    It covers the bottom half of the screen, which on a results page is most of
    the results. BACK closes the keyboard when it is open and only navigates
    when it is not, so this checks first rather than risking leaving the screen.
    """
    shown = adb("shell", "dumpsys", "input_method")
    if "mInputShown=true" in shown or "mVisibleBound" in shown:
        adb("shell", "input", "keyevent", "111")  # ESC, closes IME, never navigates
        time.sleep(0.4)
    print("keyboard hidden")


def demo_mode(on: bool) -> None:
    """Android's built-in clean status bar, meant for exactly this.

    Real footage shows a 21% battery, a stack of notification icons and
    whatever the clock happens to say. Demo mode pins full signal, full
    battery and a fixed time, so every video matches and none of them leak
    what is on the phone.

    Always turn it off afterwards, or the phone keeps lying about its battery.
    """
    global _demo_on
    adb("shell", "settings", "put", "global", "sysui_demo_allowed", "1")
    broadcast = ["shell", "am", "broadcast", "-a", "com.android.systemui.demo"]
    if not on:
        adb(*broadcast, "-e", "command", "exit")
        _demo_on = False
        print("demo mode off")
        return
    _demo_on = True
    for extras in [
        ["-e", "command", "enter"],
        ["-e", "command", "clock", "-e", "hhmm", "0930"],
        ["-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false"],
        ["-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4"],
        ["-e", "command", "network", "-e", "mobile", "show", "-e", "level", "4",
         "-e", "datatype", "none"],
        ["-e", "command", "notifications", "-e", "visible", "false"],
    ]:
        adb(*broadcast, *extras)
    print("demo mode on (clean status bar)")


STEPS = {
    "tap": lambda a: tap(a),
    "type": lambda a: type_text(a),
    "wait": lambda a: wait_for(a if isinstance(a, str) else a[0],
                               30.0 if isinstance(a, str) else float(a[1])),
    "shot": lambda a: shot(a),
    "sleep": lambda a: time.sleep(float(a)),
    "key": lambda a: adb("shell", "input", "keyevent", str(a)),
    "back": lambda a: adb("shell", "input", "keyevent", "4"),
    "hide_keyboard": lambda a: hide_keyboard(),
    "demo": lambda a: demo_mode(str(a).lower() in ("on", "true", "1")),
}


def run_script(path: Path) -> None:
    script = json.loads(path.read_text())
    for i, step in enumerate(script["steps"], 1):
        action, argument = next(iter(step.items()))
        if action not in STEPS:
            raise SystemExit(f"step {i}: unknown action {action!r}")
        print(f"[{i}/{len(script['steps'])}] {action}", end=" ")
        STEPS[action](argument)


def main() -> None:
    require_device()
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)

    command, rest = sys.argv[1], sys.argv[2:]
    if command == "ls":
        for node in dump():
            mark = "*" if node["clickable"] else " "
            print(f"{mark} {node['x']:5},{node['y']:5}  {node['label'][:70]!r}")
    elif command == "run":
        run_script(Path(rest[0]))
    elif command in STEPS:
        STEPS[command](rest[0] if rest else "")
    else:
        raise SystemExit(f"unknown command {command!r}")


if __name__ == "__main__":
    main()
