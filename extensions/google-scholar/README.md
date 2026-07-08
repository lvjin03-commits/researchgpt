# ResearchAI Scholar Saver

Chrome extension for saving visible Google Scholar results into ResearchAI.

## What It Does

- Runs only on `https://scholar.google.com/*`.
- Reads the visible results on the current Google Scholar page.
- Shows a floating selection panel.
- Saves selected papers into ResearchAI.
- Supports default folder selection from the extension popup.

## Install Locally

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select this folder:

   `extensions/google-scholar`

## Configure

1. Click the extension icon.
2. Set your ResearchAI URL, for example:

   `https://your-site.vercel.app`

3. Open ResearchAI in the browser and sign in.
4. Click "Load folders".
5. Select the folders that imported papers should be saved into.

## Use

1. Open Google Scholar.
2. Search normally.
3. Use the ResearchAI panel in the lower-right corner.
4. Select papers.
5. Click "Save selected".

## Notes

This extension does not crawl Google Scholar from the server. It only reads the result page that the signed-in user is already viewing in their own browser.
