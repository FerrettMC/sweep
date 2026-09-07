#!/usr/bin/env bash
# grab.sh — stills for a slideshow.
#
# Live, straight off the phone:
#   ./grab.sh live 01            -> shots/01.png
#
# Or pull frames out of a recording you already made:
#   ./grab.sh out/fake-sale-raw.mp4 3.5 8.0 12.25
#
# Timestamps are seconds and can be fractional. Frames come out numbered in the
# order given, so the numbers match the order you want them on screen.
set -euo pipefail

mkdir -p shots

if [ "${1:-}" = "live" ]; then
  n="${2:?usage: ./grab.sh live <number>}"
  adb exec-out screencap -p > "shots/${n}.png"
  echo "shots/${n}.png"
  exit 0
fi

video="${1:?usage: ./grab.sh <video> <seconds...>}"
shift
i=1
for t in "$@"; do
  out=$(printf "shots/%02d.png" "$i")
  # -ss before -i seeks fast; accurate enough at these durations.
  ffmpeg -v error -y -ss "$t" -i "$video" -frames:v 1 "$out"
  echo "$out  (t=${t}s)"
  i=$((i + 1))
done
