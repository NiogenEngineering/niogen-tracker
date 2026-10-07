// Niogen Tracker: state shared between screens.

export const S = {
  settings: null,          // loaded on every render
  sellers: [],             // all selling sites, loaded on every render
  radioFilter: 'all',      // status tab on the Radios screen
  inv: { q: '', sort: 'partNumber', dir: 1 },
  comp: { filter: '' },    // parts filter on the asset page
  urls: [],                // object URLs to release when the screen changes
  render: async () => {},  // set by app.js: re-draw the current screen
};

export function urlFor(blob) {
  const u = URL.createObjectURL(blob);
  S.urls.push(u);
  return u;
}
export function revokeUrls() {
  S.urls.forEach((u) => URL.revokeObjectURL(u));
  S.urls = [];
}
