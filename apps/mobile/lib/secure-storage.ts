import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

function canUseWebStorage() {
  return Platform.OS === 'web' && typeof window !== 'undefined' && Boolean(window.localStorage);
}

export async function getStoredItem(key: string) {
  if (canUseWebStorage()) {
    return window.localStorage.getItem(key);
  }

  return SecureStore.getItemAsync(key);
}

export async function setStoredItem(key: string, value: string) {
  if (canUseWebStorage()) {
    window.localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

export async function deleteStoredItem(key: string) {
  if (canUseWebStorage()) {
    window.localStorage.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}

