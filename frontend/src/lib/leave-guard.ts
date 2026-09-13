import { useEffect } from "react";

export type LeaveDecision = boolean | Promise<boolean>;
export type LeaveGuard = (destinationHash: string, currentHash: string) => LeaveDecision;

type ActiveGuard = {
  hash: string;
  decide: LeaveGuard;
};

let activeGuard: ActiveGuard | null = null;
let decisionInFlight = false;
let installed = false;

function hash(): string {
  return typeof window === "undefined" ? "#/" : window.location.hash || "#/";
}

function replaceHash(value: string): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", value);
}

function replayHashChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("hashchange"));
}

function onHashChange(event: HashChangeEvent): void {
  const guard = activeGuard;
  if (!guard || hash() === guard.hash) return;

  // This listener is installed when the module is evaluated, before the App
  // route listener is mounted. Stop the route render while the async sheet is
  // deciding; otherwise Back briefly paints the destination behind the sheet.
  event.stopImmediatePropagation();
  const destination = hash();
  replaceHash(guard.hash);
  if (decisionInFlight) return;

  decisionInFlight = true;
  void Promise.resolve()
    .then(() => guard.decide(destination, guard.hash))
    .then(allowed => {
      if (!allowed || activeGuard !== guard) return;
      activeGuard = null;
      replaceHash(destination);
      replayHashChange();
    })
    .catch(() => {
      // Treat a broken/cancelled confirmation as a cancelled navigation. The
      // guarded screen is already restored and remains usable.
    })
    .finally(() => {
      decisionInFlight = false;
    });
}

export function installHashLeaveGuard(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("hashchange", onHashChange);
}

export function registerHashLeaveGuard(decide: LeaveGuard): () => void {
  installHashLeaveGuard();
  const record: ActiveGuard = { hash: hash(), decide };
  activeGuard = record;
  return () => {
    if (activeGuard === record) activeGuard = null;
  };
}

export function clearHashLeaveGuard(): void {
  activeGuard = null;
}

export function useHashLeaveGuard(enabled: boolean, decide: LeaveGuard): void {
  useEffect(() => {
    if (!enabled) return;
    return registerHashLeaveGuard(decide);
  }, [decide, enabled]);
}

installHashLeaveGuard();
