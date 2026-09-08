#!/usr/bin/env bash
# build-demo.sh — the looping demo on the landing page.
#
#   ./build-demo.sh
#
# Cuts four segments out of the raw screen recordings in out/ and joins them.
# Re-run this whenever the recordings change; the cut points are below and are
# the only thing worth editing.
set -euo pipefail
cd "$(dirname "$0")"

REEL=out/reel-raw.mp4      # search, tracking, radar
LISTS=out/lists-raw.mp4    # lists, recorded separately
OUT=out/demo.mp4

# The screen cutout in assets/phone-shell.png is 248x532, aspect 0.4662. The
# phone records at 1080x2424, which after trimming the status bar and the
# gesture pill is 1080x2231, aspect 0.4841. Cropping 40px of width rather than
# height matches the frame without losing the tab bar off the bottom: the app
# has padding at the sides and nothing at the edges to lose.
#
# 496x1064 is twice the cutout, so it stays sharp on a high-density display and
# no larger.
V="crop=1040:2231:20:130,scale=496:1064,setsar=1"
ENC=(-r 30 -fps_mode cfr -an -c:v libx264 -crf 30 -preset slow -pix_fmt yuv420p)

# -t goes AFTER -i on purpose. Before it, ffmpeg limits how much of the INPUT
# it reads, and a screen recording is variable frame rate, so a 4.5s request
# came back as 8.7s of output.
cut() { ffmpeg -v error -y -ss "$2" -i "$1" -t "$3" -vf "$V" "${ENC[@]}" "$4"; }

cut "$REEL"  4.5  4.5 out/_seg1.mp4   # five-store search results
cut "$REEL"  16.5 3.5 out/_seg2.mp4   # tracking
cut "$REEL"  27.5 4.0 out/_seg3.mp4   # deal radar
cut "$LISTS" 1.0  4.0 out/_seg4.mp4   # a list across two stores

printf "file '_seg%d.mp4'\n" 1 2 3 4 > out/_list.txt
ffmpeg -v error -y -f concat -safe 0 -i out/_list.txt -c copy "$OUT"
rm -f out/_seg*.mp4 out/_list.txt

ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT"
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT"
