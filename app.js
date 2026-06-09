/* ============================================================
   GEOBED3D — Main Application
   CesiumJS 1.112 · Free satellite imagery (ESRI) · Free terrain (Ion)
   ============================================================ */

'use strict';

// ── Color palette for layers ───────────────────────────────
const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#a855f7',
];
let paletteIdx = 0;

// ── App state ─────────────────────────────────────────────
const layers = new Map();   // name → { dataSource, color, visible, count, meta }
let selectedLayer    = null;


// ── Keys injected by server into window.__GEOBED3D_CONFIG__ ──
const _cfg      = window.__GEOBED3D_CONFIG__ || {};
if (_cfg.cesiumToken) Cesium.Ion.defaultAccessToken = _cfg.cesiumToken;
let maptilerKey = _cfg.maptilerKey || null;

// ── Viewer ────────────────────────────────────────────────
// Do NOT pass imageryProvider here — that option was deprecated in Cesium 1.104
// and silently fails. We add imagery manually after construction.
const viewer = new Cesium.Viewer('cesiumContainer', {
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  baseLayerPicker:       false,
  geocoder:              false,
  homeButton:            false,
  sceneModePicker:       false,
  navigationHelpButton:  false,
  animation:             false,
  timeline:              false,
  fullscreenButton:      false,
  vrButton:              false,
  infoBox:               false,
  selectionIndicator:    false,
  shadows:               false,
  scene3DOnly:           true,
  msaaSamples:           4,
  useBrowserRecommendedResolution: true,
  requestRenderMode:     true,
});

const scene  = viewer.scene;
const camera = viewer.camera;
const globe  = scene.globe;
const canvas = scene.canvas;

// ── Imagery ────────────────────────────────────────────────
// Always add ESRI synchronously so the globe is never blank,
// then replace with Bing Maps (Ion asset 2) if a token is present.
async function setupImagery() {
  viewer.imageryLayers.removeAll();

  // Base layer — always present, no token needed
  const esriLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      minimumLevel: 0,
      maximumLevel: 19,
      credit: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
    })
  );

  // Upgrade to Bing Maps Aerial (global, zoom 21+) when token is available
  if (Cesium.Ion.defaultAccessToken) {
    try {
      const bing = await Cesium.IonImageryProvider.fromAssetId(2);
      viewer.imageryLayers.remove(esriLayer, false);
      viewer.imageryLayers.addImageryProvider(bing);
    } catch (e) {
      console.warn('Bing Maps from Ion failed, keeping ESRI:', e);
    }
  }
}
setupImagery();

// ── Scene quality ─────────────────────────────────────────
globe.enableLighting            = true;
globe.atmosphereLightIntensity  = 15.0;
globe.showGroundAtmosphere      = true;
globe.terrainExaggeration       = 1.0;

scene.skyAtmosphere.show = true;
scene.fog.enabled        = true;
scene.fog.density        = 0.00015;

try {
  scene.postProcessStages.ambientOcclusion.enabled             = true;
  scene.postProcessStages.ambientOcclusion.uniforms.intensity  = 2.5;
  scene.postProcessStages.ambientOcclusion.uniforms.bias       = 0.1;
  scene.postProcessStages.ambientOcclusion.uniforms.lengthCap  = 0.25;
} catch (_) {}

// ── Fetch config from server (Cesium token + Maptiler key) ───────────────
let userSelectedTerrain = false;
if (_cfg.cesiumToken) {
  (async () => {
    try {
      viewer.scene.setTerrain(
        Cesium.Terrain.fromWorldTerrain({ requestWaterMask: false, requestVertexNormals: true })
      );
      setupImagery();
    } catch (e) {
      console.warn('Terrain init failed:', e);
    }
  })();
}

// ── World mode panel ──────────────────────────────────────
const worldBtn   = document.getElementById('world-btn');
const worldPanel = document.getElementById('world-panel');
const worldLabel = document.getElementById('world-label');
let worldExtraLayer    = null;  // extra imagery layer added by a mode
let worldExtraTileset  = null;  // Google 3D tileset

worldBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = worldPanel.style.display === 'flex';
  worldPanel.style.display = open ? 'none' : 'flex';
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#world-panel') && !e.target.closest('#world-btn'))
    worldPanel.style.display = 'none';
});

async function applyWorldMode(mode) {
  if (!Cesium.Ion.defaultAccessToken && !['terrain', 'opentopomap', 'maptiler'].includes(mode)) {
    notify('Cesium Ion token required', 'error'); return;
  }
  // Tear down previous extras
  if (worldExtraLayer)   { viewer.imageryLayers.remove(worldExtraLayer, true); worldExtraLayer = null; }
  if (worldExtraTileset) { viewer.scene.primitives.remove(worldExtraTileset);  worldExtraTileset = null; }
  viewer.scene.globe.maximumScreenSpaceError = 2;

  try {
    userSelectedTerrain = true;

    if (mode === 'terrain') {
      viewer.scene.setTerrain(
        Cesium.Terrain.fromWorldTerrain({ requestWaterMask: false, requestVertexNormals: true })
      );
      setupImagery();
      worldLabel.textContent = 'World Terrain';
      notify('World Terrain active', 'info');

    } else if (mode === 'bathymetry') {
      viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(2426648, {
        requestVertexNormals: true, requestWaterMask: false,
      });
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
        minimumLevel: 0, maximumLevel: 10,
        credit: 'Tiles © Esri — GEBCO, NOAA, National Geographic',
      }));
      worldLabel.textContent = 'Bathymetry';
      notify('Bathymetry active', 'success');

    } else if (mode === 'google3d') {
      setupImagery();
      viewer.scene.setTerrain(
        Cesium.Terrain.fromWorldTerrain({ requestWaterMask: false, requestVertexNormals: true })
      );
      worldExtraTileset = await Cesium.Cesium3DTileset.fromIonAssetId(2275207);
      viewer.scene.primitives.add(worldExtraTileset);
      worldLabel.textContent = 'Google 3D';
      notify('Google Photorealistic 3D Tiles active', 'success');

    } else if (mode === 'opentopomap') {
      if (Cesium.Ion.defaultAccessToken) {
        viewer.scene.setTerrain(
          Cesium.Terrain.fromWorldTerrain({ requestWaterMask: false, requestVertexNormals: true })
        );
      }
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c'],
        minimumLevel: 0,
        maximumLevel: 17,
        credit: '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors',
      }));
      worldLabel.textContent = 'OpenTopoMap';
      notify('OpenTopoMap active', 'success');

    } else if (mode === 'maptiler') {
      const key = maptilerKey;
      if (!key) { notify('Maptiler key not loaded yet — try again in a moment', 'error'); return; }
      if (Cesium.Ion.defaultAccessToken) {
        viewer.scene.setTerrain(
          Cesium.Terrain.fromWorldTerrain({ requestWaterMask: false, requestVertexNormals: true })
        );
      }
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: `https://api.maptiler.com/maps/outdoor-v2/{z}/{x}/{y}.png?key=${key}`,
        minimumLevel: 0,
        maximumLevel: 18,
        credit: '© MapTiler · © OpenStreetMap contributors',
      }));
      worldLabel.textContent = 'Maptiler';
      notify('Maptiler Outdoor active', 'success');
    }

  } catch (e) {
    console.error(e);
    notify(`Failed to load ${mode}`, 'error');
    document.querySelector('input[name="world-mode"][value="terrain"]').checked = true;
    worldLabel.textContent = 'World Terrain';
  }
  worldPanel.style.display = 'none';
}

document.querySelectorAll('input[name="world-mode"]').forEach(radio => {
  radio.addEventListener('change', () => applyWorldMode(radio.value));
});


// ── Google Maps Labels overlay toggle ─────────────────────
const labelsBtn = document.getElementById('labels-btn');
let labelsLayer = null;

labelsBtn.addEventListener('click', async () => {
  if (!Cesium.Ion.defaultAccessToken) {
    notify('Labels require a Cesium Ion token', 'error'); return;
  }
  if (labelsLayer) {
    viewer.imageryLayers.remove(labelsLayer, true);
    labelsLayer = null;
    labelsBtn.classList.remove('active');
  } else {
    try {
      const provider = await Cesium.IonImageryProvider.fromAssetId(3830185);
      labelsLayer = viewer.imageryLayers.addImageryProvider(provider);
      labelsBtn.classList.add('active');
      notify('Google Maps labels on', 'success');
    } catch (e) {
      console.error(e);
      notify('Failed to load labels', 'error');
    }
  }
});

// ── 3D Buildings (OSM Buildings, Cesium Ion asset 96188) ──
let buildingsTileset = null;
let buildingsVisible = false;

async function loadBuildings() {
  if (!Cesium.Ion.defaultAccessToken) {
    notify('3D buildings require a Cesium Ion token — add one in ⚙️ Settings', 'error');
    return;
  }
  if (buildingsTileset) return; // already loaded
  try {
    notify('Loading 3D buildings…', 'info');
    buildingsTileset = await Cesium.Cesium3DTileset.fromIonAssetId(96188);
    buildingsTileset.style = new Cesium.Cesium3DTileStyle({
      color: {
        conditions: [
          ["${feature['building']} === 'residential' || ${feature['building']} === 'apartments' || ${feature['building']} === 'house' || ${feature['building']} === 'detached'", "color('#60a5fa', 0.88)"],
          ["${feature['building']} === 'commercial' || ${feature['building']} === 'retail' || ${feature['building']} === 'shop'",                                                  "color('#fb923c', 0.88)"],
          ["${feature['building']} === 'office' || ${feature['building']} === 'government'",                                                                                       "color('#34d399', 0.88)"],
          ["${feature['building']} === 'industrial' || ${feature['building']} === 'warehouse' || ${feature['building']} === 'factory'",                                            "color('#f87171', 0.88)"],
          ["${feature['building']} === 'garage' || ${feature['building']} === 'garages' || ${feature['building']} === 'parking'",                                                  "color('#94a3b8', 0.88)"],
          ["${feature['building']} === 'school' || ${feature['building']} === 'university' || ${feature['building']} === 'college'",                                               "color('#fbbf24', 0.88)"],
          ["${feature['building']} === 'hospital' || ${feature['building']} === 'clinic'",                                                                                         "color('#f472b6', 0.88)"],
          ["${feature['building']} === 'church' || ${feature['building']} === 'cathedral' || ${feature['building']} === 'mosque' || ${feature['building']} === 'temple'",          "color('#e879f9', 0.88)"],
          ["${feature['building']} === 'hotel'",                                                                                                                                   "color('#2dd4bf', 0.88)"],
          ["${feature['building']} === 'stadium' || ${feature['building']} === 'sports_hall'",                                                                                     "color('#a78bfa', 0.88)"],
          ["true",                                                                                                                                                                  "color('#cbd5e1', 0.80)"],
        ],
      },
    });
    viewer.scene.primitives.add(buildingsTileset);
    notify('3D buildings loaded', 'success');
  } catch (e) {
    console.error('Buildings failed:', e);
    notify('Failed to load buildings — check your Ion token', 'error');
    buildingsTileset = null;
    buildingsVisible = false;
    document.getElementById('buildings-btn').classList.remove('active');
  }
}

const buildingsLegend = document.getElementById('buildings-legend');

document.getElementById('buildings-btn').addEventListener('click', async () => {
  buildingsVisible = !buildingsVisible;
  document.getElementById('buildings-btn').classList.toggle('active', buildingsVisible);
  if (buildingsVisible) {
    // Buildings use absolute heights — exaggeration > 1.0 misaligns them
    await loadBuildings();
    if (buildingsTileset) buildingsTileset.show = true;
  } else if (buildingsTileset) {
    buildingsTileset.show = false;
  }
  updateLegendPositions();
});

// Hide Cesium credit display
viewer.creditDisplay.container.style.display = 'none';

// Initial camera
camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(0, 20, 18000000),
  orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
});

// ── Loading screen ────────────────────────────────────────
const loadingEl   = document.getElementById('loading');
const loadingBar  = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');
let globeReady = false;
let maxTiles = 0;

function markReady() {
  if (globeReady) return;
  globeReady = true;
  loadingBar.style.width = '100%';
  loadingText.textContent = 'Ready';
  setTimeout(() => fadeOut(loadingEl), 350);
}

// Primary: tile progress counter
globe.tileLoadProgressEvent.addEventListener((remaining) => {
  if (remaining > maxTiles) maxTiles = remaining;
  const pct = maxTiles > 0 ? Math.round((1 - remaining / maxTiles) * 100) : 0;
  loadingBar.style.width = `${pct}%`;
  loadingText.textContent = `Loading tiles… ${pct}%`;
  if (remaining === 0) markReady();
});

// Fallback A: postRender fires every frame — catch tilesLoaded becoming true
const unsubRender = scene.postRender.addEventListener(() => {
  if (globe.tilesLoaded) { unsubRender(); markReady(); }
});

// Fallback B: hard timeout in case nothing loads (e.g. offline / CORS)
setTimeout(markReady, 6000);

function fadeOut(el) {
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 650);
}

// ── Helper: hex → Cesium.Color ────────────────────────────
function hexColor(hex, alpha = 1) {
  const r = parseInt(hex.slice(1,3), 16) / 255;
  const g = parseInt(hex.slice(3,5), 16) / 255;
  const b = parseInt(hex.slice(5,7), 16) / 255;
  return new Cesium.Color(r, g, b, alpha);
}

// ── GeoJSON feature property helpers ──────────────────────
function getProp(entity, key) {
  return entity.properties?.[key]?.getValue?.(Cesium.JulianDate.now()) ?? null;
}

// Allow only <strong>, <i>, <br>, <a href> in note HTML.
// All <a> tags get target="_blank" rel="noopener" regardless of what the author wrote.
function sanitizeNote(html) {
  // Strip all tags except the allowed set (keep the raw match for allowed ones)
  let out = String(html).replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g,
    (match, tag) => /^(strong|i|br|a)$/i.test(tag) ? match : ''
  );
  // Force every <a ...> to open in a new tab
  out = out.replace(/<a\b[^>]*>/gi, (tag) => {
    // Extract href if present
    const hrefMatch = tag.match(/href\s*=\s*(['"])(.*?)\1/i);
    const href = hrefMatch ? hrefMatch[2] : '#';
    return `<a href="${href}" target="_blank" rel="noopener">`;
  });
  return out;
}



// Keys that control styling — not shown in the properties panel
const STYLE_PROPS = new Set(['color','title','note','noteimage','icon','iconsize','opacity']);

// ── Pre-process GeoJSON: map our custom point props to Cesium's simplestyle ──
// Cesium's GeoJsonDataSource natively reads marker-color and marker-size
// from feature properties (simplestyle-spec), so we map our properties to those.
function preprocessGeoJSON(data) {
  if (!data?.features) return data;
  const out = JSON.parse(JSON.stringify(data)); // clone so we don't mutate caller's data
  for (const f of out.features) {
    if (f.geometry?.type !== 'Point') continue;
    const p = f.properties ?? {};
    if (p.color    && !p['marker-color']) p['marker-color'] = p.color;
    if (p.iconsize && !p['marker-size'])  p['marker-size']  = String(p.iconsize).toLowerCase();
  }
  return out;
}

// ── Load GeoJSON ──────────────────────────────────────────
async function loadGeoJSON(name, geojsonData) {
  // Avoid duplicate names
  let uniqueName = name;
  let n = 2;
  while (layers.has(uniqueName)) { uniqueName = `${name} (${n++})`; }
  name = uniqueName;

  const hex   = PALETTE[paletteIdx++ % PALETTE.length];
  const color = hexColor(hex);

  try {
    const ds = await Cesium.GeoJsonDataSource.load(preprocessGeoJSON(geojsonData), {
      stroke:      color,
      fill:        hexColor(hex, 0.35),
      strokeWidth: 2.5,
      clampToGround: true,
    });

    // Style each entity (respects per-feature properties)
    let pts = 0, lines = 0, polys = 0;
    const jd = Cesium.JulianDate.now();
    const labelOverlay = document.getElementById('label-overlay');
    const labelEntries = [];
    for (const e of ds.entities.values) {
      // Per-entity color override
      const propColorHex = getProp(e, 'color');
      const eHex   = propColorHex || hex;
      const eColor = propColorHex ? hexColor(propColorHex) : color;

      // Cesium renders GeoJSON points as billboards (pins).
      // Color & size are handled by preprocessGeoJSON (marker-color / marker-size).
      // For custom icons: load via HTMLImageElement first so we know the pixel
      // data is ready (and catch CORS/404 errors) before swapping the billboard.
      if (e.billboard) {
        const iconUrl = getProp(e, 'icon');
        const sizeKey = (getProp(e, 'iconsize') ?? 'medium').toLowerCase();
        const sz = sizeKey === 'small' ? 24 : sizeKey === 'large' ? 56 : 36;
        if (iconUrl) {
          e.billboard.width  = sz;
          e.billboard.height = sz;
          e.billboard.verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
          e.billboard.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
          e.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
          const fetchAsBlob = (urls) => {
            if (!urls.length) { console.warn('[GeoBed3D] icon failed to load:', iconUrl); return; }
            fetch(urls[0])
              .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
              .then(blob => {
                e.billboard.image = URL.createObjectURL(blob);
                viewer.scene.requestRender();
              })
              .catch(() => fetchAsBlob(urls.slice(1)));
          };
          const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
          const localProxy = 'proxy.php?a=img&url=' + encodeURIComponent(iconUrl);
          const wsrvProxy  = 'https://wsrv.nl/?url=' + encodeURIComponent(iconUrl);
          fetchAsBlob(isLocal ? [localProxy, iconUrl] : [iconUrl, wsrvProxy]);
        } else {
          e.billboard.width  = sz;
          e.billboard.height = sz;
          e.billboard.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
          e.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
        }
        pts++;
      } else if (e.point) {
        const sizeKey = (getProp(e, 'iconsize') ?? 'medium').toLowerCase();
        const ptSize  = sizeKey === 'small' ? 7 : sizeKey === 'large' ? 16 : 10;
        e.point.color        = eColor;
        e.point.outlineColor = Cesium.Color.WHITE.withAlpha(0.8);
        e.point.outlineWidth = 2;
        e.point.pixelSize    = ptSize;
        e.point.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
        e.point.disableDepthTestDistance = Number.POSITIVE_INFINITY;
        pts++;
      }

      if (e.polyline) {
        const lineWidth = 3;
        e.polyline.material = new Cesium.ColorMaterialProperty(eColor);
        e.polyline.width         = lineWidth;
        e.polyline.clampToGround = true;
        // Set midpoint position so labels attach to polylines
        const positions = e.polyline.positions.getValue(jd);
        if (positions?.length) {
          e.position = new Cesium.ConstantPositionProperty(positions[Math.floor(positions.length / 2)]);
        }
        lines++;
      }

      if (e.polygon) {
        const opacityRaw = getProp(e, 'opacity');
        const opacity = opacityRaw != null ? Math.max(0, Math.min(100, Number(opacityRaw))) / 100 : 0.75;
        e.polygon.material     = new Cesium.ColorMaterialProperty(hexColor(eHex, opacity));
        e.polygon.outline      = true;
        e.polygon.outlineColor = eColor;
        e.polygon.outlineWidth = 2;
        e.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
        // Compute centroid so polygon labels have a position
        const hier = e.polygon.hierarchy?.getValue(jd);
        if (hier?.positions?.length) {
          let cx = 0, cy = 0, cz = 0;
          for (const p of hier.positions) { cx += p.x; cy += p.y; cz += p.z; }
          const n = hier.positions.length;
          e.position = new Cesium.ConstantPositionProperty(new Cesium.Cartesian3(cx/n, cy/n, cz/n));
        }
        polys++;
      }

      // HTML overlay label — clean browser text rendering, zero SDF artifacts
      const titleText = getProp(e, 'title');
      if (titleText && e.position) {
        const szKey = (getProp(e, 'iconsize') ?? 'medium').toLowerCase();
        const offsetY = szKey === 'small' ? -10 : szKey === 'large' ? -55 : -35;
        const div = document.createElement('div');
        div.className = 'map-label';
        div.textContent = String(titleText);
        labelOverlay.appendChild(div);
        labelEntries.push({ div, entity: e, offsetY });
      }
    }

    await viewer.dataSources.add(ds);

    const total = ds.entities.values.length;
    const parts = [];
    if (pts)   parts.push(`${pts} point${pts>1?'s':''}`);
    if (lines) parts.push(`${lines} line${lines>1?'s':''}`);
    if (polys) parts.push(`${polys} polygon${polys>1?'s':''}`);
    const meta = parts.length ? parts.join(', ') : `${total} features`;

    layers.set(name, { dataSource: ds, color: hex, visible: true, count: total, meta, labels: labelEntries });
    updateLayersList();
    updateStatusBar();
    notify(`Loaded "${name}" — ${meta}`, 'success');

    viewer.flyTo(ds, {
      duration: 2.0,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 50000),
    });
  } catch (err) {
    console.error(err);
    notify(`Failed to load "${name}": ${err.message}`, 'error');
  }
}

// ── File handling ─────────────────────────────────────────
function handleFiles(files) {
  for (const file of files) {
    if (!file.name.match(/\.(geojson|json)$/i)) {
      notify(`Unsupported file: ${file.name}`, 'error');
      continue;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const basename = file.name.replace(/\.(geojson|json)$/i, '');
        loadGeoJSON(basename, data);
      } catch {
        notify(`Invalid JSON: ${file.name}`, 'error');
      }
    };
    reader.readAsText(file);
  }
}

document.getElementById('file-input').addEventListener('change', (e) => {
  handleFiles(e.target.files);
  e.target.value = ''; // allow re-upload of same file
});

// Upload area drag & drop
const uploadArea = document.getElementById('upload-area');
uploadArea.addEventListener('dragover',  (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', ()  => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

// Global drag-over-canvas drop
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.target === canvas || e.target === document.getElementById('cesiumContainer')) {
    handleFiles(e.dataTransfer.files);
  }
});

// ── Layer list UI ─────────────────────────────────────────
function updateLayersList() {
  const list   = document.getElementById('layers-list');
  const empty  = document.getElementById('empty-state');
  list.innerHTML = '';

  if (layers.size === 0) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  layers.forEach((layer, name) => {
    const item = document.createElement('div');
    item.className = `layer-item${selectedLayer === name ? ' selected' : ''}`;
    item.innerHTML = `
      <div class="layer-row">
        <div class="layer-swatch" style="background:${layer.color};color:${layer.color}"></div>
        <span class="layer-name" title="${name}">${name}</span>
        <div class="layer-actions">
          <button class="layer-act-btn" title="${layer.visible ? 'Hide' : 'Show'}"
            onclick="toggleLayer(event,'${CSS.escape(name)}')">${layer.visible ? '👁' : '○'}</button>
          <button class="layer-act-btn" title="Fly to"
            onclick="flyToLayer(event,'${CSS.escape(name)}')">⊕</button>
          <button class="layer-act-btn del" title="Remove"
            onclick="removeLayer(event,'${CSS.escape(name)}')">✕</button>
        </div>
      </div>
      <div class="layer-meta">${layer.meta}</div>`;
    item.addEventListener('click', () => { selectedLayer = name; updateLayersList(); });
    list.appendChild(item);
  });
}

// These need to be globals so inline onclick handlers work
window.toggleLayer = (ev, name) => {
  ev.stopPropagation();
  const layer = layers.get(name);
  if (!layer) return;
  layer.visible = !layer.visible;
  layer.dataSource.show = layer.visible;
  updateLayersList();
};
window.flyToLayer = (ev, name) => {
  ev.stopPropagation();
  const layer = layers.get(name);
  if (!layer) return;
  viewer.flyTo(layer.dataSource, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 0),
  });
};
window.removeLayer = (ev, name) => {
  ev.stopPropagation();
  const layer = layers.get(name);
  if (!layer) return;
  viewer.dataSources.remove(layer.dataSource, true);
  layer.labels?.forEach(({ div }) => div.remove());
  layers.delete(name);
  if (selectedLayer === name) selectedLayer = null;
  updateLayersList();
  updateStatusBar();
  notify(`Removed "${name}"`, 'info');
};

document.getElementById('clear-all-btn').addEventListener('click', () => {
  if (!layers.size) return;
  layers.forEach((l) => viewer.dataSources.remove(l.dataSource, true));
  layers.clear();
  selectedLayer = null;
  updateLayersList();
  updateStatusBar();
  notify('All layers cleared', 'info');
});

function updateStatusBar() {
  const n = layers.size;
  document.getElementById('layer-count').textContent = `${n} layer${n !== 1 ? 's' : ''}`;
}

// ── Mouse / pointer tracking ──────────────────────────────
const evHandler = new Cesium.ScreenSpaceEventHandler(canvas);

evHandler.setInputAction((mv) => {
  const cart = camera.pickEllipsoid(mv.endPosition, globe.ellipsoid);
  if (cart) {
    const carto = Cesium.Cartographic.fromCartesian(cart);
    const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(5);
    const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(5);
    document.getElementById('coords-display').textContent = `${lat}°, ${lon}°`;
  }
  // Camera altitude
  const camCarto = Cesium.Cartographic.fromCartesian(camera.position);
  const km = (camCarto.height / 1000).toFixed(1);
  document.getElementById('alt-display').textContent = `${km} km`;
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

// ── Feature click → info / note panel ────────────────────
evHandler.setInputAction((click) => {
  const picked = scene.pick(click.position);
  if (!Cesium.defined(picked) || !picked.id) return;

  const entity = picked.id;

  // Photo entity clicked
  if (photoEntityMap.has(entity.id)) {
    const pageid      = photoEntityMap.get(entity.id);
    const cached      = photoPageCache.get(pageid);
    const infoTitle   = document.getElementById('info-title');
    const infoContent = document.getElementById('info-content');
    infoTitle.textContent = '';
    infoContent.innerHTML = `<div class="note-title">${cached?.title ?? 'Loading…'}</div><div class="note-text">Loading image…</div>`;
    document.getElementById('info-panel').style.display = 'flex';
    fetchPhotoDetail(pageid).then(pd => {
      if (!pd) return;
      let html = `<div class="note-title">${pd.title}</div>`;
      if (pd.imageUrl) html += `<img class="note-img" src="${pd.imageUrl}" alt="" onerror="this.style.display='none'">`;
      if (pd.description) html += `<div class="note-text">${pd.description}</div>`;
      html += `<div class="note-text" style="margin-top:0.75rem">
        <a href="${pd.sourceUrl}" target="_blank" rel="noopener">View on Wikimedia Commons →</a>
      </div>`;
      infoContent.innerHTML = html;
    });
    return;
  }

  if (!entity.properties) return;
  const props  = entity.properties;
  const keys   = props.propertyNames;

  const title     = getProp(entity, 'title');
  const note      = getProp(entity, 'note');
  const noteimage = getProp(entity, 'noteimage');

  if (!note && !noteimage) return;

  const infoTitle   = document.getElementById('info-title');
  const infoContent = document.getElementById('info-content');

  infoTitle.textContent = '';
  let html = '';
  if (title)     html += `<div class="note-title">${String(title)}</div>`;
  if (noteimage) html += `<img class="note-img" src="${noteimage}" alt="" onerror="this.style.display='none'">`;
  if (note)      html += `<div class="note-text">${sanitizeNote(String(note))}</div>`;
  infoContent.innerHTML = html;

  document.getElementById('info-panel').style.display = 'flex';
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

document.getElementById('close-info-btn').addEventListener('click', () => {
  document.getElementById('info-panel').style.display = 'none';
});

// ── Wikimedia Commons Photos ───────────────────────────────
const photosBtn      = document.getElementById('photos-btn');
let   photosActive   = false;
let   photoFetchTimer = null;
// Persistent caches — never cleared while Photos is active, only on toggle-off
const photoPageCache  = new Map(); // pageid  → {entity, title, pageid}
const photoEntityMap  = new Map(); // entity.id → pageid  (for click lookup)

const PHOTO_ICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<rect x="1" y="8" width="30" height="19" rx="3" fill="#0f172a" stroke="#60a5fa" stroke-width="1.5"/>' +
  '<circle cx="16" cy="17" r="7" fill="#60a5fa"/>' +
  '<circle cx="16" cy="17" r="4" fill="#0f172a"/>' +
  '<circle cx="16" cy="17" r="2" fill="#60a5fa" opacity="0.6"/>' +
  '<rect x="11" y="4" width="10" height="6" rx="2" fill="#0f172a" stroke="#60a5fa" stroke-width="1.5"/>' +
  '<circle cx="26" cy="12" r="1.5" fill="#60a5fa"/>' +
  '</svg>'
);

function clearAllPhotoEntities() {
  for (const { entity } of photoPageCache.values()) viewer.entities.remove(entity);
  photoPageCache.clear();
  photoEntityMap.clear();
}

// Initial fetch — coordinates only, no imageinfo (fast, lightweight)
async function fetchPhotoIcons() {
  if (!photosActive) return;
  const carto = viewer.camera.positionCartographic;
  if (carto.height > 400000) return;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  try {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query' +
      `&list=geosearch&gscoord=${lat}|${lon}&gsradius=10000&gslimit=500&gsnamespace=6` +
      '&format=json&origin=*';
    const data = await fetch(url).then(r => r.json());
    if (!data.query?.geosearch) return;
    let added = 0;
    for (const item of data.query.geosearch) {
      if (photoPageCache.has(item.pageid)) continue; // already on map
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat),
        billboard: {
          image: PHOTO_ICON,
          width: 28, height: 28,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      photoPageCache.set(item.pageid, { entity, title: item.title.replace(/^File:/, ''), pageid: item.pageid });
      photoEntityMap.set(entity.id, item.pageid);
      added++;
    }
    if (added) viewer.scene.requestRender();
  } catch (e) { console.error('Photos fetch error:', e); }
}

// Lazy detail fetch — called only on click
async function fetchPhotoDetail(pageid) {
  const cached = photoPageCache.get(pageid);
  if (!cached) return null;
  if (cached.imageUrl) return cached; // already fetched
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&pageids=${pageid}` +
      '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=600&format=json&origin=*';
    const data  = await fetch(url).then(r => r.json());
    const page  = data.query?.pages?.[pageid];
    const info  = page?.imageinfo?.[0];
    if (info) {
      cached.imageUrl    = info.thumburl || info.url;
      cached.description = (info.extmetadata?.ImageDescription?.value ?? '').replace(/<[^>]*>/g, '').trim();
      cached.sourceUrl   = `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`;
    }
  } catch (e) { console.error('Photo detail fetch error:', e); }
  return cached;
}

photosBtn.addEventListener('click', () => {
  photosActive = !photosActive;
  photosBtn.classList.toggle('active', photosActive);
  if (photosActive) { fetchPhotoIcons(); }
  else              { clearAllPhotoEntities(); viewer.scene.requestRender(); }
});

camera.changed.addEventListener(() => {
  if (!photosActive) return;
  clearTimeout(photoFetchTimer);
  photoFetchTimer = setTimeout(fetchPhotoIcons, 800);
});

// ── Compass ───────────────────────────────────────────────
camera.changed.addEventListener(() => {
  const deg = Cesium.Math.toDegrees(camera.heading);
  document.getElementById('compass-needle')
    .setAttribute('transform', `rotate(${deg}, 30, 30)`);
});
document.getElementById('compass').addEventListener('click', () => {
  camera.flyTo({
    destination: camera.position,
    orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
    duration: 1.0,
  });
});

// ── Terrain toggle ────────────────────────────────────────

// ── Zoom & nav buttons ────────────────────────────────────
document.getElementById('zoom-in-btn').addEventListener('click', () => {
  const h = Cesium.Cartographic.fromCartesian(camera.position).height;
  camera.zoomIn(h * 0.35);
});
document.getElementById('zoom-out-btn').addEventListener('click', () => {
  const h = Cesium.Cartographic.fromCartesian(camera.position).height;
  camera.zoomOut(h * 0.55);
});
document.getElementById('home-btn').addEventListener('click', () => camera.flyHome(1.5));
document.getElementById('north-btn').addEventListener('click', () => {
  camera.flyTo({
    destination: camera.position,
    orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
    duration: 0.9,
  });
});

// ── Search / Geocoder (Nominatim — no key needed) ─────────
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
let searchTimer = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 3) { searchResults.style.display = 'none'; return; }
  searchTimer = setTimeout(() => geocode(q), 350);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { searchResults.style.display = 'none'; searchInput.blur(); }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-wrap')) searchResults.style.display = 'none';
});

async function geocode(q) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (!data.length) { searchResults.style.display = 'none'; return; }

    searchResults.innerHTML = data.map((r) => {
      const parts = r.display_name.split(',');
      const name   = parts[0].trim();
      const detail = parts.slice(1, 3).join(',').trim();
      return `<div class="search-result-item" data-lon="${r.lon}" data-lat="${r.lat}">
        <div class="search-result-name">${name}</div>
        <div class="search-result-detail">${detail}</div>
      </div>`;
    }).join('');

    searchResults.querySelectorAll('.search-result-item').forEach((el) => {
      el.addEventListener('click', () => {
        const lon = parseFloat(el.dataset.lon);
        const lat = parseFloat(el.dataset.lat);
        flyToCoords(lon, lat);
        searchResults.style.display = 'none';
        searchInput.value = el.querySelector('.search-result-name').textContent;
      });
    });
    searchResults.style.display = 'block';
  } catch { /* silent */ }
}

function flyToCoords(lon, lat, altitude = 50000) {
  // lookAt keeps the target at screen center regardless of pitch
  const target = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  const offset = new Cesium.HeadingPitchRange(
    0,
    Cesium.Math.toRadians(-60),
    altitude
  );
  camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
    offset,
    duration: 2.0,
  });
}


// ── Settings modal ────────────────────────────────────────

// ── Notifications ─────────────────────────────────────────
function notify(msg, type = 'info') {
  const icons = { success: '✔', error: '✖', info: '●' };
  const el = document.createElement('div');
  el.className = `notif ${type}`;
  el.innerHTML = `<span>${icons[type] || '●'}</span><span>${msg}</span>`;
  document.getElementById('notifications').appendChild(el);
  setTimeout(() => {
    el.style.opacity  = '0';
    el.style.transform = 'translateX(12px)';
    setTimeout(() => el.remove(), 320);
  }, 4000);
}

// ── Status bar init ───────────────────────────────────────
updateLayersList();
updateStatusBar();
document.getElementById('status-text').textContent =
  'Ready · drop a GeoJSON file or search for a location';

// ── Road network (ESRI World Transportation — dynamic rendering, any zoom) ──
// usePreCachedTilesIfAvailable:false forces the MapServer to render tiles
// dynamically at any zoom level instead of serving pre-cached tiles that stop at z19.
let roadsLayer   = null;
let roadsVisible = false;
const buildingsLegendEl = document.getElementById('buildings-legend');

function updateLegendPositions() {
  buildingsLegendEl.style.display = buildingsVisible ? 'flex' : 'none';
  buildingsLegendEl.style.left = '14px';
}

document.getElementById('roads-btn').addEventListener('click', () => {
  roadsVisible = !roadsVisible;
  document.getElementById('roads-btn').classList.toggle('active', roadsVisible);

  if (roadsVisible) {
    roadsLayer = viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
        credit: 'Roads © Esri',
        minimumLevel: 0,
        maximumLevel: 19,
      })
    );
    notify('Road network enabled', 'success');
  } else {
    if (roadsLayer) { viewer.imageryLayers.remove(roadsLayer, true); roadsLayer = null; }
  }
  updateLegendPositions();
});

// ── Sun / Lighting modes ──────────────────────────────────
const sunBtn          = document.getElementById('sun-btn');
const sunPanel        = document.getElementById('sun-panel');
const sunLabel        = document.getElementById('sun-label');
const sunSlider       = document.getElementById('sun-slider');
const sunDaySlider    = document.getElementById('sun-day-slider');
const sunTimeDisplay  = document.getElementById('sun-time-display');
const sunDateDisplay  = document.getElementById('sun-date-display');
const sunSliderWrap   = document.getElementById('sun-slider-wrap');

// Initialise day slider to today's day-of-year
const now = new Date();
const startOfYear = new Date(now.getFullYear(), 0, 0);
const todayDoy = Math.floor((now - startOfYear) / 86400000);
sunDaySlider.value = todayDoy;
sunTimeDisplay.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
sunSlider.value = now.getHours() * 60 + now.getMinutes();

// Toggle panel open/close
sunBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = sunPanel.style.display === 'flex';
  sunPanel.style.display = open ? 'none' : 'flex';
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#sun-panel') && !e.target.closest('#sun-btn')) {
    sunPanel.style.display = 'none';
  }
});

function applyLightingMode(mode) {
  if (mode === 'real') {
    globe.enableLighting = true;
    viewer.clock.shouldAnimate = true;
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());
    viewer.clock.multiplier  = 1;
    sunLabel.textContent = 'Real sun';
    sunSliderWrap.style.display = 'none';

  } else if (mode === 'allday') {
    globe.enableLighting = false;
    viewer.clock.shouldAnimate = false;
    sunLabel.textContent = 'All-day';
    sunSliderWrap.style.display = 'none';

  } else if (mode === 'manual') {
    globe.enableLighting = true;
    viewer.clock.shouldAnimate = false;
    sunLabel.textContent = 'Manual sun';
    sunSliderWrap.style.display = 'flex';
    applyManualTime();
  }
}

function applyManualTime() {
  const minutes = parseInt(sunSlider.value);
  const doy     = parseInt(sunDaySlider.value);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  const d = new Date(now.getFullYear(), 0, 1 + doy, h, m, 0, 0);
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(d);

  sunTimeDisplay.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  sunDateDisplay.textContent = `${months[d.getMonth()]} ${d.getDate()}`;
}

document.querySelectorAll('input[name="sun-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => applyLightingMode(radio.value));
});

sunSlider.addEventListener('input', applyManualTime);
sunDaySlider.addEventListener('input', applyManualTime);

// All-day light is default
applyLightingMode('allday');

// ── HTML label overlay — update positions every frame ─────
const _labelOverlay = document.getElementById('label-overlay');
viewer.scene.postRender.addEventListener(() => {
  for (const [, layer] of layers) {
    if (!layer.labels?.length) continue;
    for (const { div, entity, offsetY } of layer.labels) {
      if (!layer.visible) { div.style.visibility = 'hidden'; continue; }
      const pos = entity.position?.getValue(Cesium.JulianDate.now());
      if (!pos) { div.style.visibility = 'hidden'; continue; }
      const win = scene.cartesianToCanvasCoordinates(pos);
      if (!win) { div.style.visibility = 'hidden'; continue; }
      const cw = viewer.canvas.clientWidth, ch = viewer.canvas.clientHeight;
      if (win.x < 0 || win.x > cw || win.y < 0 || win.y > ch) {
        div.style.visibility = 'hidden'; continue;
      }
      div.style.visibility = 'visible';
      div.style.left = (win.x - 10) + 'px';
      div.style.top  = (win.y + offsetY) + 'px';
    }
  }
});

// ── Side panel tabs ────────────────────────────────────────
const sidePanelTitle = document.getElementById('side-panel-title');
const clearAllBtn    = document.getElementById('clear-all-btn');

const TAB_TITLES = { geojson: 'Layers', apis: 'APIs', fcm: 'FCM' };

document.querySelectorAll('.side-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.side-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.side-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    sidePanelTitle.textContent = TAB_TITLES[tab.dataset.tab] ?? '';
    clearAllBtn.style.display  = tab.dataset.tab === 'geojson' ? '' : 'none';
  });
});


// ── APIs tab — country switcher ────────────────────────────
document.getElementById('apis-country').addEventListener('change', (e) => {
  document.querySelectorAll('.apis-country-apis').forEach(el => el.style.display = 'none');
  const panel = document.getElementById(`apis-${e.target.value}`);
  if (panel) panel.style.display = '';
});

// ── BarentsWatch Live AIS ──────────────────────────────────
const aisToggleBtn    = document.getElementById('ais-toggle');
const aisCountEl      = document.getElementById('ais-count');


let aisActive    = false;
let aisToken     = null;
let aisTokenExp  = 0;
let aisPollTimer = null;
let aisFetching  = false;
let aisFilter    = 'all'; // 'all' | type label | 'hurtigruten'


// Separate DataSource keeps AIS entities isolated from GeoJSON layers
const aisDataSource = new Cesium.CustomDataSource('ais');
viewer.dataSources.add(aisDataSource);
const aisEntityMap  = new Map(); // mmsi → entity

// ── Ship type → label + color ──────────────────────────────
function shipTypeInfo(t) {
  if (t >= 80 && t <= 89) return { label: 'Tanker',     color: '#f97316' };
  if (t >= 70 && t <= 79) return { label: 'Cargo',      color: '#3b82f6' };
  if (t >= 60 && t <= 69) return { label: 'Passenger',  color: '#10b981' };
  if (t === 30)            return { label: 'Fishing',    color: '#fbbf24' };
  if (t === 35)            return { label: 'Military',   color: '#ef4444' };
  if (t >= 50 && t <= 52) return { label: 'SAR / Pilot',color: '#f1f5f9' };
  if (t >= 40 && t <= 49) return { label: 'High Speed', color: '#06b6d4' };
  if (t >= 36 && t <= 37) return { label: 'Pleasure',   color: '#ec4899' };
  if (t >= 21 && t <= 32) return { label: 'Tug / Work', color: '#8b5cf6' };
  return { label: 'Other', color: '#94a3b8' };
}

// ── Ship billboard: flat directional arrow, bow pointing up ──
function makeShipIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="-10 -10 20 20">
    <polygon points="0,-9 7,7 0,3 -7,7" fill="${color}" stroke="rgba(0,0,0,.7)" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const SHIP_ICON_CACHE = new Map();
function cachedShipIcon(color) {
  if (!SHIP_ICON_CACHE.has(color)) SHIP_ICON_CACHE.set(color, makeShipIcon(color));
  return SHIP_ICON_CACHE.get(color);
}

// ── OAuth token ────────────────────────────────────────────
async function getAISToken() {
  if (aisToken && Date.now() < aisTokenExp - 60000) return aisToken;
  const resp = await fetch('proxy.php?a=ais-token', { method: 'POST' });
  if (!resp.ok) {
    let detail = '';
    try { const e = await resp.json(); detail = e.error_description || e.error || ''; } catch (_) {}
    console.error('AIS auth error', resp.status, detail);
    throw new Error(`Auth failed (${resp.status})${detail ? ': ' + detail : ''}`);
  }
  const d = await resp.json();
  aisToken    = d.access_token;
  aisTokenExp = Date.now() + (d.expires_in ?? 3600) * 1000;
  return aisToken;
}

// ── Fetch + render vessels ─────────────────────────────────
async function fetchAISData() {
  if (!aisActive || aisFetching) return;
  aisFetching = true;
  try {
    const token = await getAISToken();
    const resp  = await fetch(`proxy.php?a=ais-data&token=${encodeURIComponent(token)}`);
    if (!resp.ok) throw new Error(`AIS fetch failed (${resp.status})`);
    const vessels = await resp.json();
    renderAISVessels(Array.isArray(vessels) ? vessels : (vessels.features ?? []));
  } catch (e) {
    console.error('AIS:', e);
    if (aisActive) notify(`AIS: ${e.message}`, 'error');
  } finally {
    aisFetching = false;
  }
}

function renderAISVessels(vessels) {
  const seen = new Set();
  for (const v of vessels) {
    const lat  = v.latitude  ?? v.lat;
    const lon  = v.longitude ?? v.lon;
    if (lat == null || lon == null) continue;

    const mmsi    = v.mmsi;
    const { label, color } = shipTypeInfo(v.shipType ?? v.shiptype ?? 0);
    // heading 511 = not available in AIS spec, fall back to COG
    const hdg     = (v.heading != null && v.heading !== 511) ? v.heading : (v.courseOverGround ?? v.cog ?? 0);
    const speed   = (v.speedOverGround ?? v.sog ?? 0).toFixed(1);
    const name    = (v.name ?? v.shipname ?? '').trim() || `MMSI ${mmsi}`;
    const dest    = (v.destination ?? '—').trim();
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const rot = -Cesium.Math.toRadians(hdg);
    seen.add(mmsi);

    if (aisEntityMap.has(mmsi)) {
      const ent = aisEntityMap.get(mmsi);
      ent.position           = new Cesium.ConstantPositionProperty(pos);
      ent.billboard.rotation = rot;
      ent.billboard.image    = cachedShipIcon(color);
      ent._aisType           = label;
    } else {
      const ent = aisDataSource.entities.add({
        position: pos,
        billboard: {
          image:                    cachedShipIcon(color),
          width:                    20,
          height:                   20,
          rotation:                 rot,
          alignedAxis:              Cesium.Cartesian3.ZERO,
          heightReference:          Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance:          new Cesium.NearFarScalar(5e3, 1.5, 1.5e6, 0.4),
        },
        properties: {
          name,
          type:        label,
          speed:       `${speed} kn`,
          heading:     `${Math.round(hdg)}°`,
          destination: dest,
          mmsi,
        },
      });
      ent._aisType = label;
      aisEntityMap.set(mmsi, ent);
    }
  }

  // Remove vessels no longer in the feed
  for (const [mmsi, ent] of aisEntityMap) {
    if (!seen.has(mmsi)) {
      aisDataSource.entities.remove(ent);
      aisEntityMap.delete(mmsi);
    }
  }

  applyAISFilter();
  aisCountEl.textContent = `${seen.size} vessels`;
  viewer.scene.requestRender();
}

function applyAISFilter() {
  for (const [, ent] of aisEntityMap) {
    if (aisFilter === 'all') {
      ent.show = true;
    } else {
      ent.show = ent._aisType === aisFilter;
    }
  }
  viewer.scene.requestRender();
}

// ── Filter buttons ─────────────────────────────────────────
const aisFiltersEl = document.getElementById('ais-filters');
document.querySelectorAll('.ais-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ais-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    aisFilter = btn.dataset.filter;
    applyAISFilter();
  });
});

function clearAISEntities() {
  aisDataSource.entities.removeAll();
  aisEntityMap.clear();
  aisCountEl.textContent = '0 vessels';
  viewer.scene.requestRender();
}

// ── Toggle ─────────────────────────────────────────────────
aisToggleBtn.addEventListener('click', async () => {
  if (!aisActive) {
    try {
      notify('Connecting to BarentsWatch AIS…', 'info');
      await getAISToken();
    } catch (e) {
      notify(`AIS auth failed: ${e.message}`, 'error'); return;
    }
    aisActive = true;
    aisToggleBtn.classList.add('active');
    document.getElementById('ais-meta').classList.add('visible');
    aisFiltersEl.classList.add('visible');
    await fetchAISData();
    aisPollTimer = setInterval(fetchAISData, 15000);
    notify('AIS live traffic active — updates every 15 s', 'success');
  } else {
    aisActive = false;
    clearInterval(aisPollTimer);
    clearAISEntities();
    aisToken = null;
    aisToggleBtn.classList.remove('active');
    document.getElementById('ais-meta').classList.remove('visible');
    aisFiltersEl.classList.remove('visible');
    notify('AIS off', 'info');
  }
});

document.getElementById('ais-flyto-btn').addEventListener('click', () => {
  if (aisDataSource.entities.values.length === 0) return;
  viewer.flyTo(aisDataSource, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 0),
  });
});

console.log('%cGeoBed3D ready', 'color:#3b82f6;font-weight:bold;font-size:14px');
