# Daily numbered event map

Overview and each expanded Itinerary date, including past trips, offer an on-demand **MapLibre + standard OpenStreetMap raster** day map. The legacy Google Static adapter is never selected at runtime (see below). Loading a map changes no canonical event/expense, approval, AI or Calendar record.

## Map-only interaction

Opening **Day map** loads the map at once (D-081); its "?" button says what is sent (D-088). Merely opening a date makes no provider call, and **Reload map** repeats the lookup. Numbered pins follow the visible chronological timeline; directional connections represent visit order, **not road geometry**. Compact mode-icon/time labels stay on each located adjacent connection, with a small localized **Directions** link beside each estimate. Selecting a pin makes its place label a Google Maps handoff; grouped pins retain visit cycling. No wide footer button or duplicate event list. Repeated/coincident places retain numbered visits; dense days may require panning/zooming.

Walking/driving estimates come from deterministic FOSSGIS OSRM summaries, not an LLM, straight-line speed or scheduled gap. Walking above five hours is omitted. No public-transport timetable source is configured: Directions opens Google Maps with both endpoints and no fixed mode for available live choices. Cached estimates are not live traffic or historical traffic for old trips. Unknown places/times stay unavailable, and an unresolved intermediate stop never becomes a shortcut. Accessible labels preserve full mode names/distances. Keep visible OSM/routing attribution and Fix the map links. WebGL/provider failures leave the ordinary timeline usable.

A successful OSM response with no verified coordinates still renders a neutral world basemap, with a prominent explanation and expanded unresolved-place reasons. It does not invent pins, routes or a trip location; All stops is disabled until a real coordinate exists. A renderer/WebGL failure offers **Retry map display**, which only reinitializes the renderer from the current mounted authorized response, without another lookup request. Ordinary **Reload map** still performs server revalidation. Closing the map or changing trip/member/date/locale/privacy/projection clears that response as before.

## Privacy and provider boundary

The map uses the same authorized day projection as the app: all-day first, then actual start/endpoint times, grouped by **trip-zone** date. Every stop time uses its [location-local clock](EVENT_LOCAL_TIME.md), or the trip's clock when unknown, with no zone name (D-109); no added provider call. UTC order/map-day membership stay unchanged. Accommodation appears on check-in date, independently of the staying-at card. Pending updates replace canonical display; creates/restores remain pending and cancellations are omitted. Mapping never approves changes. Raw personal Calendar rows must be imported first.

Private stops the viewer can see are **included by default** (D-081). **Include private places** turns them off, and the browser remembers that choice: one localStorage flag, never map data. An included private stop uses its saved exact coordinates, or else its place text alone goes to the place lookup like a trip-visible stop's, and legs that touch it are routed. Titles, dates, notes and members are never sent, and private lookups and routes are **never written to the shared cache**. Text with private-looking wording (home, room, booking and similar) is still never looked up. Tile providers necessarily see the viewed geographic area and browser network address. Results and selection reset when trip/member/date/locale or relevant stop projection changes; turning private places off or on reloads the map.

`POST /api/trips/:tripId/map` accepts only tripDayId, locale and includePrivate, with same-origin authentication/current membership. The server derives places; client event IDs/coordinates/place text are not trusted. Exact identity and the projected day are checked again after provider work. Changed access/data discards the response. Per-user responses remain private/no-store and vary by Cookie; map content is feedback-redacted and excluded from offline snapshots/service-worker storage.

## Public data and cache

1. Reuse exact coordinates explicitly saved in trusted Maps coordinate queries or one unambiguous venue-coordinate pair. Never use `@lat,lng` camera centers, city/weather fallback or followed short links as venue evidence.
2. Resolve a stop's place text through a bounded Photon query: a trip-visible stop's, or an included private stop's without caching it. Reject accidental secret/contact/booking identifiers or residential/private wording. Ambiguous/wrong-branch results remain unplotted. Send public venue text only, not titles, dates, notes, members, bills or booking context.
3. Route adjacent located public endpoints through the separate FOSSGIS car/foot profiles. Validate bounded summaries and nearby road snaps. No Google scraping or paid fallback.
4. Reuse hash-keyed public cache entries across requests/restarts. Provider/query bind venues; provider/direction/endpoints/mode bind routes. Moving a location uses a new key. No trip/member IDs, titles, dates, notes or private locations enter the cache.

Each atomic cache file is capped at 1,024 entries / 256 KiB. Positive venues expire after 180 days; successful routes after 30 days; negative geographic results after 7 days. Network failures are not false negative evidence. Expired entries are evicted on writes. This is disposable acceleration, not canonical data or audit history. Cache failures must not bypass provider bounds.

Matching version 3 handles full native Japanese venue names followed by independently supported geographic context and recognizes tower/lighthouse POIs. Version 4 accepts saved "venue, street, city, region postcode" text, as Google Maps saves it: the whole venue name before the first comma must equal the result's name, and the result's postcode, or its city together with its state, must appear as a later part. Streets are not compared, because sources spell them differently ("12 West 300 North" against "300 North"). Exact name/branch and unique-candidate checks remain mandatory; multilingual aliases or missing coverage are not guessed. The cache key includes matching policy version, so old false negatives do not suppress corrected lookups; existing entries/files are retained.

## Operator setup

No key, billing account, OAuth scope, regional dataset or separate map server is required for a modest deployment.

`pnpm dev` and `pnpm build` first run `scripts/prepare-map-assets.mjs`. It copies the exact installed MapLibre worker/shared modules and licence into ignored versioned `public/vendor/maplibre/`; standalone preparation includes these local assets. The renderer sets that explicit worker URL, so Next chunk renaming cannot break the default worker-relative URL. No remote SDK, runtime CDN dependency or generated vendor code is committed.

| Variable | Default / purpose |
| --- | --- |
| `STARDUST_MAP_TILE_URL` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; public HTTPS/keyless template |
| `STARDUST_MAP_GEOCODER` | Set `off` to disable public lookup |
| `STARDUST_MAP_GEOCODER_URL` | Photon-compatible `https://photon.komoot.io/api/` |
| `STARDUST_MAP_ROUTER` | Set `off` to disable estimates |
| `STARDUST_MAP_ROUTER_URL` | FOSSGIS-compatible `https://routing.openstreetmap.de/` |
| `STARDUST_MAP_CACHE_DIR` | Absolute override; defaults to `../.local/day-map-cache` relative to the repository, recognizing Next's `.next/standalone` runtime directory |

Next's standalone server changes its working directory to `.next/standalone`; the resolver normalizes that suffix back to the repository, so development and standalone execution share one `.local/day-map-cache` directory beside the repository, outside Git and `.next`. Preserve it across builds. The app creates the directory on first use, so the process must be able to write there; where the default location is not writable (for example in a container where the app user cannot write beside the application directory), set `STARDUST_MAP_CACHE_DIR` to a writable absolute path. A relative value disables public lookup and routing. The cache is small, disposable and needs no backup. Never put credentials in endpoint overrides. Alternate services require compatible APIs/policies/attribution selected by the operator.

Photon/FOSSGIS requests identify Stardust and serialize to one start/second per provider per process. Each map allows six new geocodes and eight new route-mode calls, at most 24 adjacent legs, and bounded provider work inside a total 20-second deadline. Cached results do not consume new lookup allowances. Later explicit loads can reuse partial cached work; no automatic retry/poll/prefetch/AI call. Ordinary members, including ordinary trip owners, have four starts/user/minute and 30 ordinary starts/process/minute. The verified platform operator is exempt from both rolling application quotas and does not consume member quota. All callers still share one active request per user/four globally, provider pacing and all execution bounds; active work returns a distinct localized busy notice, not a misleading quota warning. The server derives operator status from `OWNER_GOOGLE_EMAIL` and stored verified Google identity on every request, never from a trip role or browser field. Body limit 2 KiB/five seconds, provider JSON 64 KiB, projected stops 500.

These are **single-process** limits: each application instance enforces its own. Running several instances, or public growth, needs shared limiting/cache and a provider-capacity review. Community hosting is best-effort/no SLA and may throttle/block heavy use; no metered API credits does not mean no infrastructure cost. OSM tiles use normal browser cache/referrer, visible viewing only, no offline download or bulk prefetch. Substantial scale/offline maps need a suitably permitted provider or self-hosting.

The legacy Google adapter remains only for explicit isolated dependency injection/tests, **not a runtime fallback**. Its proxy still needs delivery-policy/browser-key review before activation. Sign-in/Calendar/demo credentials are unrelated.

## Verification and rollback

Synthetic tests cover dates, transport, pending/audience projection, coordinate/matching validation, route/cache/rate limits, deadlines, stale authorization, tile validation and localized UI. Live provider probes use a few public landmarks, never private trip exports. Browser checks use the actual component with synthetic data when no existing authenticated app session is available.

Rollback is code-only: the map has no migration, so no down migration or data edit is needed. The public lookup cache may remain; if you clear it, delete only the cache directory, never its broader parent.

## Official references checked October 7, 2026

- [MapLibre raster source](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/).
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/): attribution, normal cache/referrer, no bulk/offline prefetch, best-effort service.
- [Photon public server](https://github.com/komoot/photon#demo-server): reasonable use, potential throttling, no SLA.
- [FOSSGIS usage](https://routing.openstreetmap.de/about.html): car/foot, attribution/fix-map link, identification, one request/second maximum, no heavy usage, server request logs.
- [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started): explicit-endpoint keyless directions.
