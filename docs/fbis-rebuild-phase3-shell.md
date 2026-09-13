# FBIS Rebuild — Phase 3 checkpoint (App shell / navigation)

## Delivered

- Product shell: `src/app/AppShell.jsx`, `src/app/navigation.js`, `src/app/shell.css`
- Customer navigation: TODAY · MARKETS · PLAYER PROPS · MY BETS · PERFORMANCE · RESEARCH
- Admin entry: SYSTEM (legacy SYS / TrackView)
- Sports as filters (ALL / CFB / NFL / MLB / NBA / CBB), not primary tabs
- Brand-forward header: **FBIS** + date + tagline `Model → Market → Movement → Price → Decision`
- URL state: `route` + `sportFilter` preserved alongside legacy `tab` / `sport`
- Placeholders for Phase 6–8 surfaces (no fake data)

## Preserved

- Existing Today / Board / My Bets / TrackView loaders and health states
- Action remains shadow (no router / qualify / authorize changes)
- No bankroll dollars introduced
- Browser refresh still polls FBIS APIs only (not paid provider collection)

## Tests

- `test/app-navigation.test.js`
- Existing suite + Vite build

## Next

Phase 4 — Today command-center rebuild (Top opportunities, movers, watchlist, full slate; no fake Top 5).
