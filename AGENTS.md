# AGENTS.md

## Cursor Cloud specific instructions

This is a **client-side only SPA** (no backend, no database, no Docker). The entire stack is Vite + Vanilla JS + Tailwind CSS v4.

### Running the app

- `npm run dev` starts the Vite dev server on `http://localhost:5173` with HMR.
- The Vite proxy in `vite.config.js` forwards `/api` to `https://api.muapi.ai` to handle CORS during development.
- Actual AI generation requires a Muapi.ai API key entered in the browser (stored in `localStorage` as `muapi_key`). Without the key, all UI navigation and interaction works, but generation requests will fail.

### Build & preview

- `npm run build` produces the production bundle in `dist/`.
- `npm run preview` serves the built output locally.

### Lint / test

- There are **no lint or test scripts** defined in `package.json`. No ESLint, Prettier, or test framework is configured.
- The `puppeteer` dependency exists but is unused in application source code.

### Project structure

See `README.md` for the full architecture diagram. Key files: `src/main.js` (entry), `src/lib/models.js` (200+ model definitions), `src/lib/muapi.js` (API client), and the `src/components/` directory.
