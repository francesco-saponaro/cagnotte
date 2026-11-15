import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { memoryStorage, type SessionStorage } from "./session";

/** Where the session lives: the browser's localStorage on the web, AsyncStorage on a phone. */
export function platformStorage(): SessionStorage {
  if (Platform.OS === "web") {
    try {
      const local = globalThis.localStorage;
      local.getItem("cagnotte.probe");
      return {
        get: async (key) => local.getItem(key),
        set: async (key, value) => local.setItem(key, value),
        remove: async (key) => local.removeItem(key),
      };
    } catch {
      // A private window or blocked site data: the session lives for this page load only.
      return memoryStorage();
    }
  }
  return {
    get: (key) => AsyncStorage.getItem(key),
    set: (key, value) => AsyncStorage.setItem(key, value),
    remove: (key) => AsyncStorage.removeItem(key),
  };
}
