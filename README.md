# Nerio

Next.js (App Router) port of the Nerio design prototypes: the reader site, the admin pipeline, the design-system reference and a breakpoints canvas.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
```

## Routes

| Route | Screen |
| --- | --- |
| `/` | Home: hero carousel, continue reading, trending, updates, genres |
| `/series/[id]` | Series detail and chapter list |
| `/read/[id]/[ch]` | Reader (shortcuts: ← → J K F S C H ? Esc) |
| `/profile?tab=…` | Overview, bookmarks, history, following, achievements, settings |
| `/premium` | Bank-transfer Premium flow (info → pending → confirmed) |
| `/admin/*` | Overview, series, chapters, upload, queue, review, processing, users, reports, settings |
| `/design-system` | Tokens and component reference |
| `/breakpoints` | Live iframes of key screens at common widths |

## Structure

- `lib/data.ts`, `lib/admin-data.ts`: mock content (stand-ins for a real API).
- `components/ui.tsx`: shared primitives (Button, IconButton, Cover, Segmented, Switch, toasts).
- `components/site/*`: reader site; `store.tsx` holds bookmarks, payment and reader prefs, persisted to `localStorage`.
- `components/admin/*`: admin screens; `store.tsx` simulates workers, the upload pipeline and review state.
- `app/globals.css`: design tokens and shared classes. Area styles are in `app/(site)/site.css` and `app/admin/admin.css`.

All data is mocked client-side. There's no backend yet.
# NerioV2
