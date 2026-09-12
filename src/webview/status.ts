import type { WebviewAction } from "../shared/protocol";

import { els } from "./dom";

/** A button offered in the status bar, and the host action it posts. */
export interface StatusActionSpec {
  label: string;
  action: WebviewAction;
}

// The bar holds at most two buttons: a primary route and one alternative. The
// actions live beside the labels so clearing a status cannot leave a stale
// action wired to a button the user can still see.
const actionSlots: (StatusActionSpec | null)[] = [null, null];

function slotButtons(): readonly HTMLButtonElement[] {
  return [els.statusAction, els.statusActionSecondary];
}

function hideActions(): void {
  const buttons = slotButtons();
  for (let i = 0; i < buttons.length; i++) {
    actionSlots[i] = null;
    buttons[i].hidden = true;
    buttons[i].textContent = "";
  }
}

export function showStatus(text: string, variant: "warning" | "loading" | "info"): void {
  // Expose the live region and set its urgency BEFORE writing the text, so the
  // text change lands in an already-visible status region and gets announced
  // (warnings assertively, progress/info politely).
  els.status.hidden = false;
  els.status.setAttribute("aria-live", variant === "warning" ? "assertive" : "polite");
  // Reset any action buttons; callers re-show them via setStatusActions.
  hideActions();
  if (variant === "warning") {
    els.status.classList.add("is-warning");
    els.statusSpinner.hidden = true;
  } else if (variant === "loading") {
    els.status.classList.remove("is-warning");
    els.statusSpinner.hidden = false;
  } else {
    els.status.classList.remove("is-warning");
    els.statusSpinner.hidden = true;
  }
  els.statusText.textContent = text;
}

export function clearStatus(): void {
  els.status.hidden = true;
  els.statusText.textContent = "";
  els.statusSpinner.hidden = true;
  hideActions();
  els.status.classList.remove("is-warning");
}

/**
 * Offer up to two buttons inside the status bar (e.g. "Copy command" plus
 * "Open settings"). Entries past the second are dropped. The clicks are wired
 * once in main.ts, which reads the action back via statusActionAt.
 */
export function setStatusActions(actions: readonly StatusActionSpec[]): void {
  const buttons = slotButtons();
  for (let i = 0; i < buttons.length; i++) {
    const spec = actions[i] ?? null;
    actionSlots[i] = spec;
    if (spec === null) {
      buttons[i].hidden = true;
      buttons[i].textContent = "";
    } else {
      buttons[i].textContent = spec.label;
      buttons[i].hidden = false;
    }
  }
}

/**
 * The action behind the button at `index`, or null when that button is not
 * currently offered. Guards on `hidden` so a status cleared between render and
 * click cannot post a stale action.
 */
export function statusActionAt(index: number): WebviewAction | null {
  const button = slotButtons()[index];
  const spec = actionSlots[index];
  if (!button || button.hidden || spec === null) {
    return null;
  }
  return spec.action;
}

export function flashFeedback(playing: boolean): void {
  // swap the center icon: play triangle vs pause bars
  if (playing) {
    els.flashIcon.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"></path>';
  } else {
    els.flashIcon.innerHTML = '<path d="M6 5h4v14H6zm8 0h4v14h-4z" fill="currentColor"></path>';
  }
  els.flash.classList.remove("show");
  // force reflow so the animation restarts on rapid toggles
  void els.flash.offsetWidth;
  els.flash.classList.add("show");
}
