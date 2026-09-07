#!/usr/bin/env bash
# record.sh — record the phone screen while you use Sweep.
#
#   ./record.sh fake-sale 30
#
# Records for N seconds (default 30, Android caps at 180), pulls the file into
# out/, and tells you the resolution so make.py knows what it's cropping.
#
# Android's screenrecord writes to the device, not to stdout, so this cannot be
# piped. It records, waits, then pulls.
set -euo pipefail

name="${1:?usage: ./record.sh <name> [seconds]}"
seconds="${2:-30}"
remote="/sdcard/sweep-ad-${name}.mp4"
local="out/${name}-raw.mp4"

mkdir -p out

if ! adb get-state >/dev/null 2>&1; then
  echo "No device. Plug the phone in and check 'adb devices'." >&2
  exit 1
fi

echo "Recording ${seconds}s. Go and do the thing on the phone."
# --bit-rate high, because the default makes text mushy once TikTok
# re-encodes it. The file is local and thrown away, so size doesn't matter.
adb shell screenrecord --bit-rate 12000000 --time-limit "$seconds" "$remote"

echo "Pulling..."
adb pull -a "$remote" "$local" >/dev/null
adb shell rm "$remote"

echo "$local"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration \
  -of default=noprint_wrappers=1 "$local"
