# GeoBed3D

3D GeoJSON viewer built on CesiumJS. Load GeoJSON files, explore them on a satellite terrain globe, and model causal dynamics with the FCM (Fuzzy Cognitive Map) tool.

![License](https://img.shields.io/badge/license-AGPL%20v3-blue)

**Live demo:** https://hcilab.no/geobed3d/ — password: `Sintef0373`

<table>
<tr>
<td><img src="https://hcilab.no/geobed3d/promo/photo01.png"/></td>
<td><img src="https://hcilab.no/geobed3d/promo/photo02.png?v=2"/></td>
</tr>
<tr>
<td><img src="https://hcilab.no/geobed3d/promo/photo03.png"/></td>
<td><img src="https://hcilab.no/geobed3d/promo/photo04.png"/></td>
</tr>
<tr>
<td><img src="https://hcilab.no/geobed3d/promo/photo05.png"/></td>
<td><img src="https://hcilab.no/geobed3d/promo/photo06.png"/></td>
</tr>
<tr>
<td><img src="https://hcilab.no/geobed3d/promo/photo07.png"/></td>
<td><img src="https://hcilab.no/geobed3d/promo/photo08.png"/></td>
</tr>
<tr>
<td><img src="https://hcilab.no/geobed3d/promo/photo09.png"/></td>
<td><img src="https://hcilab.no/geobed3d/promo/photo10.png"/></td>
</tr>
<tr>
<td><img src="https://hcilab.no/geobed3d/promo/photo11.png"/></td>
<td><img src="https://hcilab.no/geobed3d/promo/photo12.png"/></td>
</tr>
<tr>
<td><img src="https://hcilab.no/geobed3d/promo/photo13.png"/></td>
<td><img src="https://hcilab.no/geobed3d/promo/photo14.png"/></td>
</tr>
<tr>
<td><img src="https://hcilab.no/geobed3d/promo/photo15.png"/></td>
<td><img src="https://hcilab.no/geobed3d/promo/photo16.png"/></td>
</tr>
</table>

## Open data

All data layers in GeoBed3D are sourced from free, open services — no proprietary data required.

| Layer | Source | Where to get it |
|---|---|---|
| 3D terrain | Cesium World Terrain (via Cesium Ion) | [ion.cesium.com](https://ion.cesium.com) — free account |
| 3D buildings | Cesium OSM Buildings (via Cesium Ion) | [ion.cesium.com](https://ion.cesium.com) — free account |
| Roads, labels, outdoor basemap | OpenStreetMap via Maptiler | [maptiler.com](https://www.maptiler.com) — free tier |
| Satellite imagery | ESRI World Imagery (ArcGIS) | No key required — used as default basemap |
| Live sun & atmosphere | CesiumJS built-in | No key required |
| Geotagged photos | Wikimedia Commons | No key required — fetched by location automatically |
| Live AIS ship traffic | BarentsWatch | [barentswatch.no](https://www.barentswatch.no) — free account, register an API client |

## Setup

**1. Copy the config template and fill in your keys:**

```bash
cp config.example.json config.json
```

Edit `config.json`:

| Key | Where to get it |
|---|---|
| `CESIUM_TOKEN` | [ion.cesium.com](https://ion.cesium.com) — free tier |
| `MAPTILER_KEY` | [maptiler.com](https://www.maptiler.com) — free tier |
| `BW_CLIENT_ID` / `BW_CLIENT_SECRET` | [barentswatch.no](https://www.barentswatch.no) — free, format: `email:AppName` |
| `SITE_PASSWORD` | Any string to password-protect the app; leave empty to disable |

`config.json` is gitignored and never committed.

**2. Run locally:**

```bash
python3 server.py
```

Open [http://localhost:8765](http://localhost:8765).

**Deployed (PHP host):** upload all files including `config.json` alongside `proxy.php`. The app works without any keys — terrain and basemap fall back to flat/ESRI satellite.


## Test files

Sample files are in [`test_files/`](test_files/):

| File | What it tests |
|---|---|
| `test-geojson.geojson` | Standard GeoJSON — points, lines, polygons with styling properties |
| `test-fcm.geojson` | FCM (Fuzzy Cognitive Map) format — nodes + edges for causal map animation |

Drag and drop them into the viewer to try it out.

## GeoJSON format

GeoBed3D reads standard GeoJSON with optional custom styling properties (`color`, `title`, `note`, `noteimage`, `icon`, etc.).

- **Styling guide** — [`geojson-manual.html`](geojson-manual.html)
- **Example file** — [`test_files/test-geojson.geojson`](test_files/test-geojson.geojson)

## FCM (Fuzzy Cognitive Map)

Load a GeoJSON FeatureCollection where Point features are nodes and a top-level `edges` array defines weighted causal links. Hit **FCM** to animate propagation to equilibrium.

- **Example file** — [`test_files/test-fcm.geojson`](test_files/test-fcm.geojson)

## Future work

- **More open data** — expand built-in data layers: weather, elevation profiles, administrative boundaries, and additional free global datasets
- **Live data integrations** — connect to external APIs for real-time feeds beyond AIS: ocean sensors, metocean data, IoT streams, and vessel tracking services
- **Bathymetry and ocean focus** — dedicated support for underwater terrain, seafloor mapping, and ocean data visualization as a first-class use case
- **Session persistence** — save and restore the state of loaded layers, active toggles, and camera position across sessions
- **CMS / API layer** — a backend content and data management layer for GeoBed3D, enabling organisations to publish, version, and serve geospatial datasets directly to the platform

## Acknowledgements
 
This platform was created by the [HCI group](https://www.sintef.no/en/digital/departments/sustainable-communication-technologies/human-computer-interaction/) of SINTEF Digital and [XR Lab Norway](https://www.xrlab.no) as a testbed for projects with geographical data and related visualizations.