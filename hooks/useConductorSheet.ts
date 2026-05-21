// Module-level state for the ConductorSheet so any screen can open it
// from anywhere without prop drilling. The sheet itself is mounted once
// at root (app/_layout.tsx) and listens via useConductorSheetState();
// minimap taps from any header call openConductorSheet(context).
//
// The context string is what the sheet uses to tailor its sub-line
// (e.g. "from Hover" / "from Settings") so the user gets a quiet
// breadcrumb on where they invoked it.
//
// Implementation: React 18's useSyncExternalStore is the canonical
// way to bridge external mutable state into React's render cycle.
// It eliminates the subscribe/render race the prior hand-rolled
// pattern was vulnerable to and ensures every openConductorSheet
// call is observed by the mounted sheet.

import { useSyncExternalStore } from 'react';

import { debugLog } from '@/utils/debugLog';

type SheetState = {
  visible: boolean;
  context: string;
};

let state: SheetState = { visible: false, context: 'unknown' };
const listeners = new Set<() => void>();

function emit() {
  // Notify subscribers parameter-less — they read the current
  // snapshot via getSnapshot below. Decoupling notification from
  // payload is what useSyncExternalStore expects.
  for (const l of listeners) {
    try { l(); } catch { /* ignore individual subscriber errors */ }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): SheetState {
  return state;
}

export function openConductorSheet(context: string = 'unknown') {
  debugLog('Hook', `openConductorSheet(${context}) — listeners=${listeners.size}`);
  state = { visible: true, context };
  emit();
  debugLog('Hook', `after emit — state.visible=${state.visible}`);
}

export function closeConductorSheet() {
  // Keep the last context around — closing then re-opening from the
  // same screen shouldn't flicker the breadcrumb back to 'unknown'.
  debugLog('Hook', 'closeConductorSheet()');
  state = { visible: false, context: state.context };
  emit();
}

export function useConductorSheetState(): SheetState {
  // Same getSnapshot is passed as the server snapshot — we don't
  // SSR this app, and even if we did the sheet would always start
  // hidden. React handles the subscription lifecycle correctly
  // across concurrent renders, strict-mode double mounts, and
  // mid-render state mutations.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
