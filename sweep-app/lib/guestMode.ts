import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "sweep_guest_mode";

export async function setGuestMode(value: boolean) {
  await AsyncStorage.setItem(KEY, value ? "true" : "false");
}

export async function isGuestMode(): Promise<boolean> {
  const value = await AsyncStorage.getItem(KEY);
  return value === "true";
}
