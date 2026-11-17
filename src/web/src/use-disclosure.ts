import { useState } from "react";

export function useDisclosure(key: string, aliases: string[] = []) {
  const [open, setOpen] = useState(() => {
    try {
      for (const candidate of [key, ...aliases]) {
        const saved = sessionStorage.getItem(candidate);
        if (saved !== null) return saved === "open";
      }
      return false;
    } catch {
      return false;
    }
  });
  const update = (value: boolean) => {
    setOpen(value);
    try {
      for (const candidate of [key, ...aliases])
        sessionStorage.setItem(candidate, value ? "open" : "closed");
    } catch {
      /* Local interaction still works without storage. */
    }
  };
  return [open, update] as const;
}
