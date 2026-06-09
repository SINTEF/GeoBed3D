# GeoBed3D

3D GeoJSON viewer built on CesiumJS. Load GeoJSON files, explore them on a satellite terrain globe, and model causal dynamics with the FCM (Fuzzy Cognitive Map) tool.

![License](https://img.shields.io/badge/license-AGPL%20v3-blue)

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

## FCM (Fuzzy Cognitive Map)

Load a GeoJSON FeatureCollection where Point features are nodes and a top-level `edges` array defines weighted causal links. Hit **FCM** to animate propagation to equilibrium. See the in-app format reference for the schema.
