# ResearchGPT Scholar Saver

Chrome MV3 extension for saving visible Google Scholar results with direct PDF links into ResearchGPT.

See also: [`docs/EXTENSION.md`](../../docs/EXTENSION.md)

## What it does

- Runs on `https://scholar.google.com/*`
- Injects **Save PDF to ResearchGPT** only on visible search results with a detected PDF link
- Parses title, authors/meta, snippet, Scholar URL, and PDF URL when the user clicks save
- Skips results with no direct PDF link, so users do not see a save action that cannot work
- Sends the paper to `POST /api/extension/save-paper` via the service worker
- Supports default folder selection from the popup

## Install

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select this folder

## Configure

1. Open the extension popup
2. Set your ResearchGPT URL
3. Paste your Supabase access token (see `docs/EXTENSION.md`)
4. Save settings and load folders

## Use

1. Search on Google Scholar
2. Click **Save PDF to ResearchGPT** on any result you want to keep
3. Check save status in the popup

## Notes

This extension never crawls Scholar in the background. It only reads the result the user is viewing and only after an explicit save click.
