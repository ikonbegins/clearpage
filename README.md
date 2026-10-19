# ClearPage

A private document scanner for your phone. Point the camera at your homework, get a clean PDF. No watermarks, no ads, no account, and your photos never leave your phone.

It is a web app that installs on the iPhone Home Screen and then works like a normal app, even offline.

## What it does

- **Live page detection.** A blue outline follows the page about 10 times a second.
- **Auto capture.** Hold the phone still for one second and it takes the photo. It waits for the next page before shooting again, so you can scan a whole stack quickly.
- **Modes.** Homework, Document, Receipt, Whiteboard, Book and Photo each pick the best filter.
- **Crop fixing.** Drag the corners (with a magnifier bubble) or the edges. Auto and Full page buttons.
- **Flattening.** Pages photographed at an angle come out straight, with the right shape (it works out the real width and height, not just the edge lengths).
- **Filters.** Original, Auto, Clean (best for homework), Grayscale, B&W, Color boost and Ink saver. Every filter has a strength slider and a shadow remover. Press and hold the page to compare with the original.
- **Edits never damage the photo.** The original is kept; crops and filters are just settings you can change any time.
- **PDF export.** Page size (same as scan, Letter or A4), file size (Small, Medium, High, or a limit such as "under 2 MB" for upload portals), optional AES-256 password.
- **Searchable PDFs.** Optional text recognition (English, Russian, Uzbek and more) adds invisible text so you can search and copy words in the PDF. It also gives the document a smart name like "Worksheet 22 (Oct 19)". It works well on printed pages; handwriting is usually not recognized.
- **True redaction.** Black boxes are burned into the image, and any recognized text under them is removed, so hidden info cannot be copied out.
- **Library.** Folders, search (titles and recognized text), sort, grid or list, multi-select to merge, move, share or delete. Drag pages to reorder.
- **Trash with Undo.** Deleted documents stay 30 days.
- **Backup you control.** One ZIP with readable PDFs, the original photos and an index. Restore it any time.

## Put it on your iPhone

The camera only works on a secure (https) website, so the app needs a free address. GitHub Pages hosts it for free. Only the app's code goes there. Your scans stay on your phone.

1. Make a free account at [github.com](https://github.com) if you do not have one.
2. Create a new **public** repository named `clearpage` (no README, no .gitignore).
3. Upload this folder to it. From this folder on your PC:

   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/clearpage.git
   git push -u origin main
   ```

   A browser window opens the first time so you can sign in to GitHub.
4. On GitHub, open the repository, then **Settings → Pages**. Under "Build and deployment" pick **Deploy from a branch**, branch **main**, folder **/ (root)**, and Save.
5. After a minute your app is live at `https://YOUR-USERNAME.github.io/clearpage/`.

### Install it

1. Open that address in **Safari** on your iPhone.
2. Tap the **Share** button, then **Add to Home Screen**.
3. Open ClearPage from the Home Screen. The first time you scan, allow camera access.

Adding it to the Home Screen matters: iOS keeps the storage of Home Screen apps, but may clear website data that has not been used for a few weeks.

## Scanning homework, step by step

1. Tap **Scan**. Keep the mode on **Homework**.
2. Put the page on a darker surface if you can (white paper on a white desk is the hardest case).
3. Hold the phone above the page. When the outline turns green, hold still. It captures by itself.
4. Turn to the next page. It captures again. Repeat.
5. Tap **Done**. Check the corners of each page and tap **Next**.
6. Tap **Share**, pick a size (choose **Limit** if your school portal has a maximum), then **Share** again and choose Files, Mail, Canvas or any app.

Tips:

- Good light and no shadow from your phone or hand give the cleanest pages.
- The camera button at the top of the scanner opens the iPhone camera app instead. It takes full 12 MP photos, which is the best quality for tiny handwriting.
- For pencil, try **Clean** with a higher strength. For pen on lined paper, **Clean** or **B&W**.

## How the code is organised

Plain JavaScript modules, no build step, so GitHub Pages can serve the files as they are.

```
index.html, css/app.css      the page and its look (light and dark)
manifest.webmanifest, sw.js  install on Home Screen, work offline
js/main.js                   start-up: storage, theme, screens
js/engine/                   the scan engine: pure maths on pixels, no browser screens
  detect.js                  finds the page (edges, bright areas, straight lines; then scores them)
  geometry.js                corners, perspective maths, real page shape
  warp.js                    flattens the page
  filters.js                 shadow removal and the filters
  render.js, worker.js       runs the engine in a background thread
js/services/                 storage (IndexedDB), PDF writer, export, OCR, backup ZIP
js/ui/                       the screens: library, camera, crop, page editor, document, text, settings, trash
vendor/tesseract/            text recognition engine (Tesseract.js, Apache 2.0)
tests/                       automatic tests for the engine, PDF and ZIP
tools/                       local test server and icon maker
```

The engine is kept apart from the screens on purpose: it can be tested on the computer with photos, without a phone.

## Testing on this PC

```bash
npm install
npm run photos
npm test
```

`npm run photos` makes 94 realistic test photos (homework on desks, shadows, fingers, steep angles) with known corners. `npm test` checks that the page is found in at least 95% of them (currently 96.7%), that filters give white paper and dark ink, that PDFs open in another program, that passwords work, and that backups unzip.

To try the app in a desktop browser: `npm run serve`, then open http://localhost:5173.

## Updating the app

After changing files, push again (`git add -A`, `git commit`, `git push`). If you add a new file under `js/`, also add it to the list in `sw.js` (the tests remind you). Open apps show an "Update" message and refresh.

## Privacy

No account, no analytics, no ads, no tracking. Photos are processed on the phone and stored only in the browser storage of that phone. Nothing is uploaded. The only downloads are the app itself and, the first time you use text recognition, the text engine and language files.
