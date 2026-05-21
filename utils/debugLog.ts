// Lightweight in-process diagnostic log surface. Push entries via
// debugLog(); the DebugBanner component subscribes and renders the
// most recent entries on top of every screen. Goal: see what's
// firing in the Minimap → openConductorSheet → ConductorSheet chain
// without needing Xcode's Console.app.
//
// Toggle off by setting DEBUG_BANNER_ENABLED = false here — the
// debugLog call is still cheap (just push to an in-memory array)
// but the on-screen surface disappears.

import { useSyncExternalStore } from 'react';

export const DEBUG_BANNER_ENABLED = true;

type Entry = {
  id: number;
  at: number;
  tag: string;
  msg: string;
};

const MAX_ENTRIES = 12;
let nextId = 1;
let entries: Entry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

export function debugLog(tag: string, msg: string) {
  const entry: Entry = { id: nextId++, at: Date.now(), tag, msg };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();
  // Also forward to console so EAS / Metro logs see it too.
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${msg}`);
}

export function clearDebugLog() {
  entries = [];
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): Entry[] {
  return entries;
}

export function useDebugLog(): Entry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
