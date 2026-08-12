// lib/deviceId.ts
//
// Anonymous per-install id, so a guest's one-search-a-day cap can be enforced
// server-side. It identifies a device, not a person — nothing that matters is
// ever authorised by it.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "sweep_device_id";

let cached: string | null = null;

/** Stable across launches, regenerated only if storage is cleared. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  const stored = await AsyncStorage.getItem(KEY);
  if (stored) {
    cached = stored;
    return stored;
  }

  const fresh = uuidv4();
  await AsyncStorage.setItem(KEY, fresh);
  cached = fresh;
  return fresh;
}

/**
 * RFC-4122 v4 from Math.random. Not cryptographically strong, and doesn't need
 * to be — the server validates the shape, and the worst case for a collision
 * is two installs sharing one free daily search.
 */
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
