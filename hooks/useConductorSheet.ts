// Module-level state for the ConductorSheet so any screen can open it
// from anywhere without prop drilling. The sheet itself is mounted once
// at root (app/_layout.tsx) and listens via useConductorSheetState();
// minimap taps from any header call openConductorSheet(context).
//
// The context string is what the sheet uses to tailor its sub-line
// (e.g. "from Hover" / "from Settings") so the user gets a quiet
// breadcrumb on where they invoked it.
//
// Implementation note: a plain module-scoped state + listener set is
// preferred over pulling in zustand/jotai. The sheet has exactly one
// owner (the root layout) and a tiny API surface, so the extra
// dependency wouldn't earn its weight.

import { useEffect, useState } from 'react';

type SheetState = {
  visible: boolean;
  context: string;
};

let state: SheetState = { visible: false, context: 'unknown' };
const listeners = new Set<(s: SheetState) => void>();

function emit() {
  for (const l of listeners) l(state);
}

export function openConductorSheet(context: string = 'unknown') {
  state = { visible: true, context };
  emit();
}

export function closeConductorSheet() {
  // Keep the last context around — closing then re-opening from the
  // same screen shouldn't flicker the breadcrumb back to 'unknown'.
  state = { visible: false, context: state.context };
  emit();
}

export function useConductorSheetState(): SheetState {
  const [snapshot, setSnapshot] = useState<SheetState>(state);
  useEffect(() => {
    listeners.add(setSnapshot);
    // Sync in case state changed between render and subscribe.
    setSnapshot(state);
    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);
  return snapshot;
}
