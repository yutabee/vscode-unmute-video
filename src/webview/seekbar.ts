import { els } from "./dom";
import { PlayerController } from "./playerController";
import { formatTime, ratioInRect } from "./util";

export class Seekbar {
  private scrubbing = false;
  private wasPlayingBeforeScrub = false;

  public constructor(private readonly controller: PlayerController) {
    els.seek.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
      this.beginScrub(evt);
    });
    window.addEventListener("mousemove", (evt) => {
      this.moveScrub(evt);
    });
    window.addEventListener("mouseup", (evt) => {
      this.endScrub(evt);
    });

    // touch support
    els.seek.addEventListener("touchstart", (evt) => {
      this.beginScrub(evt);
    }, { passive: true });
    els.seek.addEventListener("touchmove", (evt) => {
      this.moveScrub(evt);
    }, { passive: true });
    els.seek.addEventListener("touchend", (evt) => {
      this.endScrub(evt);
    });
  }

  public isScrubbing(): boolean {
    return this.scrubbing;
  }

  public beginScrub(evt: MouseEvent | TouchEvent): void {
    this.scrubbing = true;
    this.wasPlayingBeforeScrub = !this.controller.isPaused();
    els.seek.classList.add("scrubbing");
    this.moveScrub(evt);
  }

  public moveScrub(evt: MouseEvent | TouchEvent): void {
    if (!this.scrubbing) {
      return;
    }
    const t = this.timeFromEvent(evt);
    const dur = isFinite(this.controller.duration) ? this.controller.duration : 0;
    const pct = dur > 0 ? (t / dur) * 100 : 0;
    els.seekPlayed.style.width = pct + "%";
    els.seekHandle.style.left = pct + "%";
    els.timeCur.textContent = formatTime(t);
  }

  public endScrub(evt: MouseEvent | TouchEvent): void {
    if (!this.scrubbing) {
      return;
    }
    const t = this.timeFromEvent(evt);
    this.scrubbing = false;
    els.seek.classList.remove("scrubbing");
    this.controller.seekTo(t);
    if (this.wasPlayingBeforeScrub) {
      this.controller.play();
    }
  }

  public timeFromEvent(evt: MouseEvent | TouchEvent): number {
    const rect = els.seek.getBoundingClientRect();
    const clientX = (evt as TouchEvent).touches ? (evt as TouchEvent).touches[0].clientX : (evt as MouseEvent).clientX;
    const ratio = ratioInRect(clientX, rect.left, rect.width);
    const dur = isFinite(this.controller.duration) ? this.controller.duration : 0;
    return ratio * dur;
  }
}
