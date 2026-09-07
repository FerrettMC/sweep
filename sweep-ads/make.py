#!/usr/bin/env python3
"""make.py — turn shots or a recording into a vertical post.

    ./make.py ads/fake-sale.json

Everything comes out 1080x1920, which is what TikTok, Reels and Shorts all
want. A phone screenshot is taller and narrower than that, so it gets scaled to
fit and padded with the app's own background colour rather than blurred bars.
Blur is the default look everywhere and it makes screen recordings of text
harder to read, which is the one thing this has to get right.

Two kinds:

  slideshow  a run of stills with a caption on each, crossfaded
  reel       one recording, optionally sped up, with captions over the top

Captions are burned in on purpose. TikTok and Instagram both strip text
overlays when a video is downloaded and reposted, and burned-in text survives.
"""
import json
import shlex
import subprocess
import sys
from pathlib import Path

W, H = 1080, 1920
BG = "0x0D0D0D"          # colours.background, so padding looks intentional
ACCENT = "0xD85A30"      # colours.accent
FONT = "/usr/share/fonts/noto/NotoSans-Bold.ttf"

# Height reserved for the caption. The screenshot is scaled to fit what is left
# and pushed to the other end, so the caption never lands on top of the app's
# own header. Overlaying looked fine on a mockup and terrible on a real screen:
# the app has its own title in exactly that spot on most pages.
BAND = 300

HERE = Path(__file__).parent


def run(args: list[str]) -> None:
    print("+", " ".join(shlex.quote(a) for a in args[:6]), "...")
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        # ffmpeg's real error is always in the last few lines, never the first.
        print("\n".join(result.stderr.strip().splitlines()[-15:]), file=sys.stderr)
        raise SystemExit(f"ffmpeg failed ({result.returncode})")


def escape(text: str) -> str:
    """Escape for drawtext, which has its own parser and is fussy about it.

    Note what is NOT escaped: "%". drawtext expands %{...} sequences by default,
    so a lone percent warns "Stray %" and the text silently fails to draw. The
    filter below sets expansion=none, which makes % an ordinary character and is
    the actual fix. Escaping it as \\% does not work and looks like it should.
    """
    for old, new in [("\\", "\\\\"), (":", "\\:"), ("'", "’")]:
        text = text.replace(old, new)
    return text


def caption_filter(text: str, position: str = "top") -> str:
    """A caption centred in its reserved band.

    No box behind it, because the band is already the flat background colour.
    A slab on top of a slab reads as a mistake.
    """
    if not text:
        return ""
    y = f"({BAND}-text_h)/2" if position == "top" else f"{H - BAND}+({BAND}-text_h)/2"
    safe = escape(text)
    return (
        f"drawtext=fontfile={FONT}:text='{safe}':expansion=none:fontcolor=white:"
        f"fontsize=62:line_spacing=12:x=(w-text_w)/2:y={y}:borderw=0"
    )


def fit(label_in: str, label_out: str, position: str = "top", caption: bool = True) -> str:
    """Scale into the space left over once the caption band is reserved.

    With a caption at the top the image is pushed down by BAND; at the bottom it
    sits flush to the top. With no caption it just centres in the whole frame.
    """
    if not caption:
        return (
            f"[{label_in}]scale={W}:{H}:force_original_aspect_ratio=decrease,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG},setsar=1[{label_out}]"
        )
    offset = BAND if position == "top" else 0
    return (
        f"[{label_in}]scale={W}:{H - BAND}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:{offset}:color={BG},setsar=1[{label_out}]"
    )


ICON = HERE.parent / "sweep-app" / "assets" / "images" / "icon.png"


def render_card(slide: dict, index: int) -> Path:
    """Generate an end card rather than screenshotting one.

    A call to action is the one slide with nothing to photograph. Generating it
    means the wording is in the ad spec next to everything else, so changing
    "link in description" to "link in bio" per platform is a text edit rather
    than a trip back to a design tool.
    """
    out = HERE / "shots" / f"_card-{index}.png"
    lines = slide.get("lines", [])
    if not lines:
        raise SystemExit("a card slide needs at least one line")

    steps = [f"color=c={BG}:s={W}x{H}[bg]"]
    last = "bg"

    if slide.get("icon", True) and ICON.exists():
        steps.append(f"[1:v]scale=280:280[icon]")
        steps.append(f"[{last}][icon]overlay=(W-w)/2:560[withicon]")
        last = "withicon"
        top = 940
    else:
        top = 780

    # First line is the headline, the rest are supporting text.
    sizes = [86] + [54] * (len(lines) - 1)
    colours = ["white"] + [ACCENT if i == 0 else "0xAAAAAA" for i in range(len(lines) - 1)]
    y = top
    for i, (line, size, colour) in enumerate(zip(lines, sizes, colours)):
        steps.append(
            f"[{last}]drawtext=fontfile={FONT}:text='{escape(line)}':expansion=none:"
            f"fontcolor={colour}:fontsize={size}:x=(w-text_w)/2:y={y}[l{i}]"
        )
        last = f"l{i}"
        y += size + (46 if i == 0 else 26)

    args = ["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:d=1"]
    if slide.get("icon", True) and ICON.exists():
        args += ["-i", str(ICON)]
    # The colour source is declared twice otherwise, once as input and once in
    # the graph, so drop the graph's own copy and start from input 0.
    steps[0] = f"[0:v]null[bg]"
    args += ["-filter_complex", ";".join(steps), "-map", f"[{last}]",
             "-frames:v", "1", str(out)]
    run(args)
    return out


def build_slideshow(spec: dict, out: Path) -> None:
    slides = spec["slides"]
    if not slides:
        raise SystemExit("slideshow needs at least one slide")

    fade = float(spec.get("crossfade", 0.4))

    # Cards are generated first, then treated as ordinary images from here on.
    for i, slide in enumerate(slides):
        if "lines" in slide and "image" not in slide:
            slide["image"] = str(render_card(slide, i).relative_to(HERE))

    args = ["ffmpeg", "-y"]
    for slide in slides:
        image = HERE / slide["image"]
        if not image.exists():
            raise SystemExit(f"missing image: {image}")
        # Each still becomes a clip of its own length. The extra `fade` is
        # eaten by the crossfade into the next one.
        seconds = float(slide.get("seconds", 2.5)) + fade
        args += ["-loop", "1", "-t", f"{seconds:.3f}", "-i", str(image)]

    steps = []
    for i, slide in enumerate(slides):
        text = slide.get("caption", "")
        position = slide.get("position", "top")
        steps.append(fit(f"{i}:v", f"s{i}", position, caption=bool(text)))
        caption = caption_filter(text, position)
        if caption:
            steps.append(f"[s{i}]{caption}[c{i}]")
        else:
            steps.append(f"[s{i}]null[c{i}]")

    # Chain the crossfades. Each xfade's offset is measured from the start of
    # the whole chain so far, not from the clip, which is the part that trips
    # everyone up.
    if len(slides) == 1:
        last = "c0"
    else:
        elapsed = float(slides[0].get("seconds", 2.5))
        last = "c0"
        for i in range(1, len(slides)):
            nxt = f"x{i}"
            steps.append(
                f"[{last}][c{i}]xfade=transition=fade:duration={fade}:"
                f"offset={elapsed:.3f}[{nxt}]"
            )
            last = nxt
            elapsed += float(slides[i].get("seconds", 2.5))

    audio_index = len(slides)
    args += audio_input(spec)

    total = sum(float(s.get("seconds", 2.5)) for s in slides)
    chain, encode = audio_chain(spec, audio_index, total)
    steps.append(chain)

    filtergraph = ";".join(steps)
    args += ["-filter_complex", filtergraph, "-map", f"[{last}]"]
    args += encode
    args += ["-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)]
    run(args)


def build_reel(spec: dict, out: Path) -> None:
    source = HERE / spec["source"]
    if not source.exists():
        raise SystemExit(f"missing recording: {source}")

    speed = float(spec.get("speed", 1.0))
    has_captions = bool(spec.get("captions"))
    steps = [fit("0:v", "fitted", "top", caption=has_captions)]
    last = "fitted"

    if speed != 1.0:
        steps.append(f"[{last}]setpts={1 / speed:.4f}*PTS[sped]")
        last = "sped"

    # Captions are timed, so one filter each with an enable window.
    for i, cap in enumerate(spec.get("captions", [])):
        start, end = float(cap["start"]), float(cap["end"])
        drawn = caption_filter(cap["text"], cap.get("position", "top"))
        drawn += f":enable='between(t,{start},{end})'"
        steps.append(f"[{last}]{drawn}[t{i}]")
        last = f"t{i}"

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(source)],
        capture_output=True, text=True,
    )
    total = float(probe.stdout.strip() or 10) / speed

    args = ["ffmpeg", "-y", "-i", str(source)]
    args += audio_input(spec)
    chain, encode = audio_chain(spec, 1, total)
    steps.append(chain)
    args += ["-filter_complex", ";".join(steps), "-map", f"[{last}]"]
    args += encode
    args += ["-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)]
    run(args)


def audio_input(spec: dict) -> list[str]:
    """The audio INPUT, which must sit with the other -i args.

    ffmpeg reads its command line in order and treats everything after an
    output-side option as belonging to the output. Declaring this late is what
    produces "cannot be applied to input url", which says nothing useful about
    the actual mistake.

    There is always an audio track, even when there is no music. A video with
    no audio stream at all gets flagged as broken by some uploaders, and TikTok
    will sometimes refuse it outright.
    """
    music = spec.get("music")
    if music:
        path = HERE / music
        if not path.exists():
            raise SystemExit(f"missing music: {path}")
        # -ss before -i seeks into the track, so "music_start" is the point in
        # the song the video begins on. Almost always wanted: the first seconds
        # of a track are an intro, and the part worth using is a chorus a
        # minute in.
        start = spec.get("music_start")
        seek = ["-ss", str(start)] if start is not None else []
        return [*seek, "-i", str(path)]
    return ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]


def audio_chain(spec: dict, index: int, duration: float) -> tuple[str, list[str]]:
    """Audio filter chain plus the args to encode it.

    Music gets a fade at both ends. Without the fade-out a track stops dead the
    instant the video does, which sounds like the file is broken rather than
    like the video ended, and it is the single most obvious tell of something
    assembled by a script.

    Volume defaults below unity because these play under captions people are
    reading, and because TikTok normalises loud uploads anyway.
    """
    if not spec.get("music"):
        return f"[{index}:a]anull[aud]", ["-map", "[aud]", "-c:a", "aac", "-b:a", "128k", "-shortest"]

    volume = float(spec.get("music_volume", 0.7))
    fade = min(1.0, duration / 6)
    chain = (
        f"[{index}:a]volume={volume},"
        f"afade=t=in:st=0:d={fade:.2f},"
        f"afade=t=out:st={max(0.0, duration - fade):.2f}:d={fade:.2f}[aud]"
    )
    return chain, ["-map", "[aud]", "-c:a", "aac", "-b:a", "192k", "-shortest"]


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: ./make.py ads/<name>.json")

    spec = json.loads(Path(sys.argv[1]).read_text())
    out_dir = HERE / "out"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{spec['name']}.mp4"

    if spec["kind"] == "slideshow":
        build_slideshow(spec, out)
    elif spec["kind"] == "reel":
        build_reel(spec, out)
    else:
        raise SystemExit(f"unknown kind: {spec['kind']}")

    print(f"\n{out}")
    subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=width,height,duration",
                    "-of", "default=noprint_wrappers=1", str(out)])


if __name__ == "__main__":
    main()
