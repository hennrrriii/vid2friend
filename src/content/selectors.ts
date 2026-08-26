/**
 * EVERY DOM selector this extension uses on YouTube. All of them. If you are
 * here because something stopped working after a YouTube redesign, this is the
 * only file you need to touch.
 *
 * How to fix a broken selector
 * ----------------------------
 * 1. Open YouTube, right click the element that is not being found, Inspect.
 * 2. Look at the element and its parents in the Elements panel. YouTube uses
 *    custom elements, so the tag name (ytd-rich-item-renderer, yt-lockup-
 *    view-model, ...) is usually the most stable thing about it. Prefer tag
 *    names and ids over generated class names.
 * 3. Add your new selector to the FRONT of the matching array below. The arrays
 *    are tried in order and the first hit wins, so putting the new one first
 *    keeps the old ones working as fallbacks for people on an older rollout.
 * 4. Reload the extension in chrome://extensions and refresh YouTube.
 *
 * YouTube A/B tests layouts constantly, which is why every entry is a list
 * rather than a single string: two people can be looking at different DOM on
 * the same day.
 */

export const SELECTORS = {
  /** The container on the homepage that the shelf is inserted in front of. */
  homeContents: [
    'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer #contents',
    'ytd-browse[page-subtype="home"] #contents.ytd-rich-grid-renderer',
    'ytd-browse[page-subtype="home"] #contents',
    '#primary > ytd-rich-grid-renderer > #contents',
  ],

  /** First row of the normal feed - the shelf goes directly above it. */
  homeFirstRow: [
    'ytd-rich-grid-row',
    'ytd-rich-item-renderer',
    'ytd-rich-section-renderer',
  ],

  /**
   * One entry inside an open three dot menu.
   *
   * These do more work than they look like they do: the open menu is located
   * by finding VISIBLE elements matching this list and taking whichever parent
   * holds the most of them. That is deliberate. Naming the menu's own container
   * turned out to be unreliable - YouTube runs at least two different menu
   * implementations side by side (the old `ytd-menu-popup-renderer` on search
   * results, the newer view-model based one on the homepage and channel pages),
   * and matching on the wrapper meant the entry appeared on some pages only.
   * The entries themselves are the one thing every variant has.
   *
   * If the entry stops appearing everywhere at once, this is the list to add to.
   */
  menuItem: [
    'ytd-menu-service-item-renderer',
    'ytd-menu-navigation-item-renderer',
    'yt-list-item-view-model',
    'tp-yt-paper-item',
  ],

  /**
   * YouTube's own thumbnail inside a feed tile. Used purely as a ruler: the
   * shelf measures one of these and sizes its cards to match, rather than
   * guessing a column count. That is what keeps the cards exactly as large as
   * the surrounding feed at any window width and zoom level.
   */
  feedThumbnail: [
    'ytd-thumbnail a#thumbnail',
    'yt-thumbnail-view-model',
    'ytd-thumbnail',
    'a#thumbnail',
    '#thumbnail',
  ],

  /** Anything that represents one video tile anywhere on the site. */
  videoTile: [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'yt-lockup-view-model',
  ],

  /** Link carrying the video id inside a tile. */
  tileLink: [
    'a#video-title-link',
    'a#video-title',
    'a#thumbnail[href]',
    'a.yt-lockup-metadata-view-model__title',
    'a[href*="/watch?v="]',
  ],

  /** Title text inside a tile. */
  tileTitle: [
    '#video-title',
    'a#video-title-link yt-formatted-string',
    'h3 a span',
    '.yt-lockup-metadata-view-model__title',
    'h3',
  ],

  /** Channel name inside a tile. */
  tileChannel: [
    'ytd-channel-name #text',
    'ytd-channel-name yt-formatted-string',
    '#channel-name #text',
    '.yt-content-metadata-view-model__metadata-text',
  ],

  /** Duration badge on a thumbnail, e.g. "12:03". */
  tileDuration: [
    'ytd-thumbnail-overlay-time-status-renderer #text',
    'ytd-thumbnail-overlay-time-status-renderer span',
    '.badge-shape-wiz__text',
    '.ytd-thumbnail-overlay-time-status-renderer',
  ],

  /** Watch page: the row holding Like / Dislike / Share / Save. */
  watchActionBar: [
    'ytd-watch-metadata #top-level-buttons-computed',
    '#actions #top-level-buttons-computed',
    'ytd-menu-renderer.ytd-watch-metadata #top-level-buttons-computed',
    '#top-level-buttons-computed',
  ],

  /** Watch page: video title. */
  watchTitle: [
    'ytd-watch-metadata h1 yt-formatted-string',
    'ytd-watch-metadata #title h1',
    'h1.ytd-watch-metadata',
    'h1.title',
  ],

  /** Watch page: channel name. */
  watchChannel: [
    'ytd-video-owner-renderer ytd-channel-name a',
    '#owner #channel-name a',
    'ytd-channel-name a',
  ],

  /** The actual media element, for watch progress. */
  videoElement: [
    'video.html5-main-video',
    '#movie_player video',
    'video',
  ],
} as const

export type SelectorKey = keyof typeof SELECTORS
