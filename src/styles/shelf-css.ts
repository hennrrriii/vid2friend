/**
 * The shelf stylesheet, as a string.
 *
 * Why a .ts file instead of a .css file: this CSS is injected into YouTube's
 * own document (no Shadow DOM, on purpose, so we inherit Roboto and YouTube's
 * theme variables). Keeping it as a string means it ships inside the content
 * script bundle and applies before the first paint of the shelf, with no extra
 * web_accessible_resource and no flash of unstyled cards.
 *
 * Two rules for anything added here:
 *   1. Every selector starts with `.v2f-`. We are a guest in this document.
 *   2. Colours come from YouTube's own custom properties where they exist, with
 *      a literal fallback. That is what makes dark mode work for free: YouTube
 *      swaps the variables when it sets `dark` on <html>, and we follow.
 */
import { BRAND } from '@/shared/brand'

export const SHELF_CSS = `
.v2f-shelf {
  /* YouTube's homepage #contents is a CSS Grid, not a plain block flow. Without
     this, the shelf is inserted as a single grid CELL and YouTube's next real
     tile renders right beside it in the same row, which looks like the two are
     related. Spanning every column makes the shelf its own full-width row,
     regardless of how many columns the grid currently has. Harmless when the
     parent is not a grid at all (the property is simply ignored). */
  grid-column: 1 / -1;
  width: 100%;

  --v2f-accent: ${BRAND.accent};
  --v2f-primary: ${BRAND.primary};
  --v2f-cols: 4;
  --v2f-gap: 16px;
  --v2f-text: var(--yt-spec-text-primary, #0f0f0f);
  --v2f-text-dim: var(--yt-spec-text-secondary, #606060);
  --v2f-surface: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
  --v2f-page: var(--yt-spec-base-background, #ffffff);

  position: relative;
  margin: 0 0 24px;
  padding: 0;
  font-family: 'Roboto', 'Arial', sans-serif;
  color: var(--v2f-text);
}

html[dark] .v2f-shelf {
  --v2f-text: var(--yt-spec-text-primary, #f1f1f1);
  --v2f-text-dim: var(--yt-spec-text-secondary, #aaaaaa);
  --v2f-surface: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.1));
  --v2f-page: var(--yt-spec-base-background, #0f0f0f);
}

/* --- header --------------------------------------------------------------- */

.v2f-shelf__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}

.v2f-shelf__logo {
  display: flex;
  line-height: 0;
  flex: 0 0 auto;
}

.v2f-shelf__title {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 2.2rem;
  letter-spacing: -0.008em;
}

.v2f-shelf__spacer { flex: 1 1 auto; }

.v2f-shelf__link {
  padding: 6px 12px;
  border: 0;
  border-radius: 18px;
  background: transparent;
  color: var(--v2f-accent);
  font-family: inherit;
  font-size: 1.4rem;
  font-weight: 500;
  cursor: pointer;
}

.v2f-shelf__link:hover { background: var(--v2f-surface); }
.v2f-shelf__link:focus-visible { outline: 2px solid var(--v2f-accent); outline-offset: 2px; }

/* --- the scrolling row ---------------------------------------------------- */

.v2f-shelf__viewport {
  position: relative;
}

.v2f-shelf__track {
  display: flex;
  gap: var(--v2f-gap);
  overflow-x: auto;
  overflow-y: hidden;
  scroll-behavior: smooth;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  padding-bottom: 4px;
}

.v2f-shelf__track::-webkit-scrollbar { display: none; }

.v2f-card {
  flex: 0 0 calc((100% - (var(--v2f-cols) - 1) * var(--v2f-gap)) / var(--v2f-cols));
  min-width: 0;
  scroll-snap-align: start;
  position: relative;
}

/* Arrows, same idea as YouTube's own shelves. Hidden until they are needed. */
.v2f-shelf__arrow {
  position: absolute;
  top: 0;
  bottom: 40px;
  width: 40px;
  display: none;
  align-items: center;
  justify-content: center;
  border: 0;
  background: var(--v2f-page);
  color: var(--v2f-text);
  cursor: pointer;
  z-index: 2;
  opacity: 0;
  transition: opacity 120ms ease;
}

.v2f-shelf__viewport:hover .v2f-shelf__arrow[data-enabled="1"] { opacity: 1; }
.v2f-shelf__arrow[data-enabled="1"] { display: flex; }
.v2f-shelf__arrow--prev { left: -8px; }
.v2f-shelf__arrow--next { right: -8px; }
.v2f-shelf__arrow:focus-visible { opacity: 1; outline: 2px solid var(--v2f-accent); }

/* --- one card ------------------------------------------------------------- */

.v2f-card__link {
  display: block;
  text-decoration: none;
  color: inherit;
}

.v2f-card__thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: var(--v2f-surface);
}

.v2f-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.v2f-card__duration {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 3px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  font-size: 1.2rem;
  font-weight: 500;
  line-height: 1.2rem;
  letter-spacing: 0.5px;
}

.v2f-card__body {
  display: flex;
  gap: 12px;
  padding: 12px 0 0;
}

/* The accent ring is one of exactly two things marking this as a
   recommendation. Everything else is deliberately native. */
.v2f-card__avatar {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 1.4rem;
  font-weight: 500;
  box-shadow: 0 0 0 2px var(--v2f-page), 0 0 0 4px var(--v2f-accent);
  margin: 2px 2px 0;
}

.v2f-card__meta { min-width: 0; flex: 1 1 auto; }

.v2f-card__title {
  margin: 0 0 4px;
  font-size: 1.6rem;
  font-weight: 500;
  line-height: 2.2rem;
  max-height: 4.4rem;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.v2f-card__by {
  font-size: 1.4rem;
  line-height: 2rem;
  color: var(--v2f-accent);
  font-weight: 500;
}

.v2f-card__channel {
  font-size: 1.3rem;
  line-height: 1.8rem;
  color: var(--v2f-text-dim);
}

.v2f-card__note {
  margin-top: 4px;
  font-size: 1.3rem;
  line-height: 1.8rem;
  color: var(--v2f-text-dim);
  font-style: italic;
  overflow-wrap: anywhere;
}

/* Dismiss, revealed on hover like YouTube's own overlay controls. */
.v2f-card__dismiss {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 100ms ease;
  z-index: 1;
}

.v2f-card:hover .v2f-card__dismiss,
.v2f-card__dismiss:focus-visible { opacity: 1; }

/* --- toast ---------------------------------------------------------------- */

.v2f-toast {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 9000;
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 420px;
  padding: 14px 16px;
  border-radius: 8px;
  background: #212121;
  color: #fff;
  font-family: 'Roboto', 'Arial', sans-serif;
  font-size: 1.4rem;
  line-height: 2rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  animation: v2f-toast-in 140ms ease-out;
}

html:not([dark]) .v2f-toast { background: #212121; }

.v2f-toast__action {
  border: 0;
  background: transparent;
  color: ${BRAND.accent};
  font: inherit;
  font-weight: 500;
  text-transform: uppercase;
  cursor: pointer;
  padding: 4px 8px;
}

@keyframes v2f-toast-in {
  from { transform: translateY(8px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}

/* --- the extra entry in the three dot menu -------------------------------- */

.v2f-menu-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  min-height: 36px;
  cursor: pointer;
  font-family: 'Roboto', 'Arial', sans-serif;
  font-size: 1.4rem;
  line-height: 2rem;
  color: var(--yt-spec-text-primary, #0f0f0f);
}

html[dark] .v2f-menu-item { color: var(--yt-spec-text-primary, #f1f1f1); }
.v2f-menu-item:hover { background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05)); }
.v2f-menu-item__icon { display: flex; flex: 0 0 24px; line-height: 0; }

/* --- the watch page button ------------------------------------------------ */

.v2f-watch-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  margin-right: 8px;
  border: 0;
  border-radius: 18px;
  background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
  color: var(--yt-spec-text-primary, #0f0f0f);
  font-family: 'Roboto', 'Arial', sans-serif;
  font-size: 1.4rem;
  font-weight: 500;
  line-height: 2rem;
  cursor: pointer;
  white-space: nowrap;
}

html[dark] .v2f-watch-button {
  background: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.1));
  color: var(--yt-spec-text-primary, #f1f1f1);
}

.v2f-watch-button:hover { filter: brightness(0.94); }
html[dark] .v2f-watch-button:hover { filter: brightness(1.25); }
.v2f-watch-button:focus-visible { outline: 2px solid ${BRAND.accent}; outline-offset: 2px; }

/* Narrow windows: icon only, same as YouTube collapses its own buttons. */
@media (max-width: 1000px) {
  .v2f-watch-button__label { display: none; }
  .v2f-watch-button { padding: 0 12px; }
}
`
