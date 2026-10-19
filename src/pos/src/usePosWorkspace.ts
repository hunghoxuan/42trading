import { useCallback, useRef, useState, type SetStateAction } from "react";
import { emptyWorkspace, readWorkspace, workspaceKey, writeWorkspace, type PosWorkspace } from "./workspace";

function load(key: string | null) {
  try { return { key, state: key ? readWorkspace(localStorage, key) : emptyWorkspace(), failed: false }; }
  catch { return { key, state: emptyWorkspace(), failed: true }; }
}

export function usePosWorkspace(userId: string | null, deviceId: string) {
  const key = userId ? workspaceKey(userId, deviceId) : null;
  const [entry, setEntry] = useState(() => load(key));
  // Reset before committing a new account's UI; never save the previous account's draft under the new key.
  let active = entry;
  if (entry.key !== key) { active = load(key); setEntry(active); }
  const latest = useRef(active);
  latest.current = active;
  const update = useCallback((change: (state: PosWorkspace) => PosWorkspace) => {
    if (latest.current.key !== key) return false;
    const state = change(latest.current.state);
    let failed = false;
    if (key) {
      try { writeWorkspace(localStorage, key, state); } catch { failed = true; }
    }
    const next = { key, state, failed };
    latest.current = next;
    setEntry(next);
    return Boolean(key) && !failed;
  }, [key]);

  function field<K extends keyof PosWorkspace>(name: K): [PosWorkspace[K], (value: SetStateAction<PosWorkspace[K]>) => void] {
    return [active.state[name], (value) => update((state) => ({ ...state, [name]: typeof value === "function"
      ? (value as (previous: PosWorkspace[K]) => PosWorkspace[K])(state[name]) : value }))];
  }
  return { field, update, state: active.state, saveFailed: active.failed };
}
