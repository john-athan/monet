# vendor/geo

The land for Die Karte (the painted map on the Orte page). Shipped as a file, not as a dependency; `build.ts` copies it unchanged to `dist/geo/` (with br and gz variants) and the client fetches `/geo/land.bin`.

## land.bin

- Source: Natural Earth 1:10m physical vectors, `ne_10m_land` and `ne_10m_minor_islands`, as GeoJSON from
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson and
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_minor_islands.geojson
- Licence: Natural Earth, public domain (https://www.naturalearthdata.com/about/terms-of-use/).
- Made by `bun tools/build-geo.ts` (downloads the two files, or `--src <dir>` to use local copies). The binary layout is described at the top of that script and decoded by `client/lib/map.ts`.
- 9633 rings, 481 687 points in the full level. No level drops a ring (a ring below the tolerance keeps its original points if it has 8 or fewer, else its four extreme points, so small islands stay land). Four levels of detail (Douglas-Peucker at 0.25, 0.05, 0.01 degrees, and the full data), coordinates quantised to 1e-5 degree and delta encoded as zigzag varints.

| level | tolerance | rings | KiB |
| --- | --- | --- | --- |
| 0 | 0.25 deg | 9633 | 320.1 |
| 1 | 0.05 deg | 9633 | 449.7 |
| 2 | 0.01 deg | 9633 | 825.0 |
| 3 | full | 9633 | 1952.9 |

| file | bytes | sha256 |
| --- | --- | --- |
| land.bin | 3632810 | 96b37c82b321d3ed35fbbcae99f789d41b3ff118e51cac9ea47fb0fce22c7bd9 |

Served compressed: about 2.40 MB as brotli, 3.34 MB as gzip.
