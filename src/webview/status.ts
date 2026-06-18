import { els } from "./dom";

export function showStatus(text: string, variant: "warning" | "loading" | "info"): void {
  // Expose the live region and set its urgency BEFORE writing the text, so the
  // text change lands in an already-visible status region and gets announced
  // (warnings assertively, progress/info politely).
  els.status.hidden = false;
  els.status.setAttribute("aria-live", variant === "warning" ? "assertive" : "polite");
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
  els.status.classList.remove("is-warning");
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
