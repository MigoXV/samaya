import { useCallback, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";

export type InputImage = {
  id: string;
  name: string;
  url: string;
  size: number;
};
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

// Image drafts stay in this tab's memory; large data URLs must not fill storage.
const drafts = new Map<string, InputImage[]>();
const empty: InputImage[] = [];
const listeners = new Set<() => void>();
export function setImageDraft(key: string, images: InputImage[]) {
  if (images.length) drafts.set(key, images);
  else drafts.delete(key);
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function useImageDraft(key: string) {
  const images = useSyncExternalStore(
    subscribe,
    () => drafts.get(key) || empty,
  );
  const update: Dispatch<SetStateAction<InputImage[]>> = useCallback(
    (value) => {
      const current = drafts.get(key) || empty;
      setImageDraft(key, typeof value === "function" ? value(current) : value);
    },
    [key],
  );
  return [images, update] as const;
}
export function readImage(file: File): Promise<InputImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id:
          crypto.randomUUID?.() ||
          Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        name: file.name || "粘贴图片",
        size: file.size,
        url: String(reader.result),
      });
    reader.onerror = () => reject(new Error("图片读取失败，请重新粘贴。"));
    reader.readAsDataURL(file);
  });
}
