# Niogen Tracker

Inventory and restoration cost tracker for vintage radios. Runs in the browser, works offline,
and keeps all data on your computer. Nothing is uploaded anywhere.

## Files
- `index.html`, `css/`, `js/`: the app. Edit these directly; there is no build step.
- `js/pricing.js`: all the pricing math in one small file.
- `js/db.js`: the database and every stock-changing action.
- `sw.js`: offline support. Change `VERSION` at the top whenever you add or rename files.
- `manifest.webmanifest`, `icons/`: what makes it installable like an app.

## Keeping your data safe
The data lives in the browser's storage for the site address you open the app from. If that
address changes (for example you rename the GitHub repository), the app starts empty. Restore your
latest backup from Settings to bring everything back. Back up from Settings regularly, or choose a
backup folder in Chrome or Edge so it happens automatically.
