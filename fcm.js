/* ============================================================
   FCM — Fuzzy Cognitive Map module for GeoBed3D
   ============================================================
   To remove this feature entirely:
     1. Delete this file (fcm.js)
     2. Remove the <!-- FCM TAB --> block from index.html
     3. Remove the <script src="fcm.js"> tag from index.html
     4. Remove the /* FCM section from style.css
     5. Remove `fcm: 'FCM'` from TAB_TITLES in app.js
   ============================================================ */
'use strict';

// ── Constants ─────────────────────────────────────────────
const FCM_DEFAULT   = 0.5;
const FCM_DAMPING   = 0.85;
const FCM_MIN_DELTA = 0.002;
const FCM_MAX_HOPS  = 12;
const FCM_NODE_ALT  = 50000; // metres above ellipsoid
const FCM_ARC_LIFT  = 40000; // extra height at arc midpoint

// ── State ─────────────────────────────────────────────────
const fcmState         = new Map(); // id → value 0..1
const fcmInitialState  = new Map(); // id → value as loaded from file
const fcmEdges         = [];         // { from, to, weight }
const fcmNodePositions = new Map(); // id → { lon, lat }
const fcmNodeLabels    = new Map(); // id → display label
let   fcmActive    = false;
let   fcmAnimating = false;
let   fcmAnimTimer = null;
let   fcmLoaded    = false;

// ── Cesium data source ────────────────────────────────────
const fcmDataSource = new Cesium.CustomDataSource('fcm');
viewer.dataSources.add(fcmDataSource);

// ── HTML escape ───────────────────────────────────────────
function fcmEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Place nodes in a circle at the current camera view ────
function fcmAutoPlace(ids) {
  if (!ids.length) return;
  const carto     = Cesium.Cartographic.fromCartesian(viewer.camera.position);
  const centerLon = Cesium.Math.toDegrees(carto.longitude);
  const centerLat = Cesium.Math.toDegrees(carto.latitude);
  // spread ~25% of the visible ground radius, capped at 20°
  const spread = Math.min(carto.height / 111320 * 0.25, 20);

  ids.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2;
    const lon   = centerLon + spread * Math.cos(angle);
    const lat   = Math.max(-80, Math.min(80, centerLat + spread * 0.6 * Math.sin(angle)));
    fcmNodePositions.set(id, { lon, lat });
  });
}

// ── Parse and load a FCM JSON object ──────────────────────
// Node formats supported:
//   "nodes": ["id"]
//   "nodes": [{ "id": "x", "label": "…", "lon": 15.5, "lat": 68.2 }]
//   "nodes": [{ "id": "x", "coordinates": [15.5, 68.2] }]   ← GeoJSON style
function fcmLoadJSON(data) {
  fcmState.clear();
  fcmEdges.length = 0;
  fcmNodePositions.clear();
  fcmNodeLabels.clear();

  const nodeIds = [];
  const needsAutoPlace = [];

  for (const n of (data.nodes ?? [])) {
    if (typeof n === 'string') {
      nodeIds.push(n);
      fcmNodeLabels.set(n, n);
      needsAutoPlace.push(n);
    } else if (n?.id) {
      nodeIds.push(n.id);
      fcmNodeLabels.set(n.id, n.label ?? n.id);
      // Accept lon/lat OR GeoJSON-style coordinates array
      if (n.lon != null && n.lat != null) {
        fcmNodePositions.set(n.id, { lon: Number(n.lon), lat: Number(n.lat) });
      } else if (Array.isArray(n.coordinates) && n.coordinates.length >= 2) {
        fcmNodePositions.set(n.id, { lon: Number(n.coordinates[0]), lat: Number(n.coordinates[1]) });
      } else {
        needsAutoPlace.push(n.id);
      }
    }
  }

  const initState = data.state ?? {};
  for (const id of nodeIds) {
    const v = typeof initState[id] === 'number' ? initState[id] : FCM_DEFAULT;
    fcmState.set(id, v);
    fcmInitialState.set(id, v);
  }

  for (const e of (data.edges ?? [])) {
    if (fcmState.has(e.from) && fcmState.has(e.to)) {
      fcmEdges.push({ from: e.from, to: e.to, weight: Number(e.weight) });
    }
  }

  fcmAutoPlace(needsAutoPlace);
  fcmShowControls();
}

// ── Load from a GeoJSON FeatureCollection of Points ───────
// Each Point feature = one FCM node.
// Node id:    properties.id   || properties.name || feature index
// Node label: properties.label|| properties.name || properties.title || id
// Node value: properties.fcm_value || FCM_DEFAULT
// Edges:      top-level "edges" array on the collection (same format as FCM JSON)
function fcmLoadGeoJSON(data) {
  fcmState.clear();
  fcmEdges.length = 0;
  fcmNodePositions.clear();
  fcmNodeLabels.clear();

  const needsAutoPlace = [];

  (data.features ?? []).forEach((f, i) => {
    if (f.geometry?.type !== 'Point') return;
    const p   = f.properties ?? {};
    const id  = String(p.id ?? p.name ?? i);
    const lbl = String(p.label ?? p.name ?? p.title ?? id);
    const [lon, lat] = f.geometry.coordinates;

    fcmNodeLabels.set(id, lbl);
    if (lon != null && lat != null) {
      fcmNodePositions.set(id, { lon: Number(lon), lat: Number(lat) });
    } else {
      needsAutoPlace.push(id);
    }
    const val = p.fcm_value ?? p.value;
    const v = typeof val === 'number' ? val : FCM_DEFAULT;
    fcmState.set(id, v);
    fcmInitialState.set(id, v);
  });

  for (const e of (data.edges ?? [])) {
    if (fcmState.has(e.from) && fcmState.has(e.to)) {
      fcmEdges.push({ from: e.from, to: e.to, weight: Number(e.weight) });
    }
  }

  fcmAutoPlace(needsAutoPlace);
  fcmShowControls();
}

function fcmShowControls() {
  fcmLoaded = true;
  document.getElementById('fcm-pre-load').style.display = 'none';
  document.getElementById('fcm-controls').classList.add('visible');
}

// ── Value → red/yellow/green color ────────────────────────
function fcmColor(v) {
  const r = v < 0.5 ? 1.0 : 2.0 - 2.0 * v;
  const g = v < 0.5 ? 2.0 * v : 1.0;
  return new Cesium.Color(r, g, 0.05, 0.95);
}

// ── Arc that lifts off from terrain and comes back down ───
function makeArcPositions(lon1, lat1, lon2, lat2, segments = 28) {
  const r1 = Cesium.Math.toRadians(lon1), φ1 = Cesium.Math.toRadians(lat1);
  const r2 = Cesium.Math.toRadians(lon2), φ2 = Cesium.Math.toRadians(lat2);
  const out = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    out.push(Cesium.Cartesian3.fromRadians(
      r1 + (r2 - r1) * t,
      φ1 + (φ2 - φ1) * t,
      FCM_ARC_LIFT * Math.sin(Math.PI * t)  // starts and ends at 0, peaks at midpoint
    ));
  }
  return out;
}

// ── Render nodes + edges on globe ─────────────────────────
function fcmRenderMap() {
  fcmDataSource.entities.removeAll();
  viewer.scene.requestRender();
  if (!fcmActive || !fcmLoaded) return;

  for (const [id, value] of fcmState) {
    const pos = fcmNodePositions.get(id);
    if (!pos) continue;
    fcmDataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 0),
      point: {
        color: fcmColor(value),
        pixelSize: 14 + value * 18,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(5e4, 1.4, 8e6, 0.5),
      },
      label: {
        text: `${fcmNodeLabels.get(id) ?? id}\n${(value * 100).toFixed(0)}%`,
        font: 'bold 11px system-ui',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: new Cesium.Color(0.04, 0.08, 0.18, 0.75),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        scaleByDistance: new Cesium.NearFarScalar(5e4, 1.2, 8e6, 0.4),
      },
    });
  }

  for (const edge of fcmEdges) {
    const p1 = fcmNodePositions.get(edge.from);
    const p2 = fcmNodePositions.get(edge.to);
    if (!p1 || !p2) continue;
    const col = edge.weight >= 0
      ? Cesium.Color.fromCssColorString('#3b82f6').withAlpha(0.8)
      : Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.8);
    fcmDataSource.entities.add({
      polyline: {
        positions: makeArcPositions(p1.lon, p1.lat, p2.lon, p2.lat),
        width: Math.max(3, Math.abs(edge.weight) * 9),
        material: new Cesium.PolylineArrowMaterialProperty(col),
        clampToGround: false,
      },
    });
  }

  viewer.scene.requestRender();
}

// ── BFS forward propagation ────────────────────────────────
function fcmPropagate(startId, delta) {
  const outgoing = new Map();
  for (const id of fcmState.keys()) outgoing.set(id, []);
  for (const e of fcmEdges) outgoing.get(e.from)?.push(e);

  const queue = [{ id: startId, delta, hop: 0 }];
  while (queue.length) {
    const { id, delta: d, hop } = queue.shift();
    if (hop >= FCM_MAX_HOPS || Math.abs(d) < FCM_MIN_DELTA) continue;
    for (const edge of (outgoing.get(id) || [])) {
      const prop = d * edge.weight * Math.pow(FCM_DAMPING, hop);
      if (Math.abs(prop) < FCM_MIN_DELTA) continue;
      const old = fcmState.get(edge.to) ?? FCM_DEFAULT;
      const nv  = Math.max(0, Math.min(1, old + prop));
      const act = nv - old;
      if (Math.abs(act) < FCM_MIN_DELTA) continue;
      fcmState.set(edge.to, nv);
      queue.push({ id: edge.to, delta: act, hop: hop + 1 });
    }
  }
}

// ── One iteration step (for Animate) ─────────────────────
function fcmStep() {
  let changed = false;
  const influence = new Map();
  for (const id of fcmState.keys()) influence.set(id, 0);
  for (const e of fcmEdges) {
    influence.set(e.to, (influence.get(e.to) ?? 0) + (fcmState.get(e.from) ?? FCM_DEFAULT) * e.weight * 0.06);
  }
  for (const [id, inf] of influence) {
    if (Math.abs(inf) < FCM_MIN_DELTA) continue;
    const old = fcmState.get(id) ?? FCM_DEFAULT;
    const nv  = Math.max(0, Math.min(1, old + inf));
    if (Math.abs(nv - old) >= FCM_MIN_DELTA) { fcmState.set(id, nv); changed = true; }
  }
  return changed;
}

// ── Render panel UI ───────────────────────────────────────
function fcmRenderPanel() {
  if (!fcmLoaded) return;

  // Node sliders
  const container = document.getElementById('fcm-nodes');
  if (container) {
    container.innerHTML = '';
    for (const [id, value] of fcmState) {
      const label = fcmNodeLabels.get(id) ?? id;
      const row   = document.createElement('div');
      row.className = 'fcm-node-row';
      row.innerHTML = `
        <div class="fcm-node-head">
          <span class="fcm-node-label" title="${fcmEsc(label)}">${fcmEsc(label)}</span>
          <span class="fcm-node-val">${(value * 100).toFixed(0)}%</span>
        </div>
        <input type="range" min="0" max="1" step="0.01" value="${value}">`;
      row.querySelector('input').addEventListener('input', (ev) => {
        const old   = fcmState.get(id) ?? FCM_DEFAULT;
        const nv    = parseFloat(ev.target.value);
        const delta = nv - old;
        fcmState.set(id, nv);
        if (Math.abs(delta) >= FCM_MIN_DELTA) fcmPropagate(id, delta);
        fcmRenderPanel();
        if (fcmActive) fcmRenderMap();
      });
      container.appendChild(row);
    }
  }

  // Edge list
  const edgeList = document.getElementById('fcm-edge-list');
  const countEl  = document.getElementById('fcm-edge-count');
  if (countEl) countEl.textContent = fcmEdges.length;
  if (edgeList) {
    if (!fcmEdges.length) {
      edgeList.innerHTML = '<div class="fcm-empty">No edges in model</div>';
    } else {
      edgeList.innerHTML = fcmEdges.map((e, i) => {
        const sign      = e.weight > 0 ? `+${e.weight.toFixed(2)}` : e.weight.toFixed(2);
        const col       = e.weight >= 0 ? '#3b82f6' : '#ef4444';
        const fromLabel = fcmEsc(fcmNodeLabels.get(e.from) ?? e.from);
        const toLabel   = fcmEsc(fcmNodeLabels.get(e.to)   ?? e.to);
        return `<div class="fcm-edge-item">
          <span class="fcm-edge-desc" style="color:${col}">${fromLabel} → ${toLabel} <b>(${sign})</b></span>
          <button class="fcm-del-edge icon-btn" data-idx="${i}" title="Remove edge">✕</button>
        </div>`;
      }).join('');
      edgeList.querySelectorAll('.fcm-del-edge').forEach(btn => {
        btn.addEventListener('click', () => {
          fcmEdges.splice(parseInt(btn.dataset.idx), 1);
          fcmRenderPanel();
          if (fcmActive) fcmRenderMap();
        });
      });
    }
  }
}

// ── File loading ──────────────────────────────────────────
function handleFcmFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.type === 'FeatureCollection') {
        // GeoJSON mode: Point features → nodes
        const pts = (data.features ?? []).filter(f => f.geometry?.type === 'Point').length;
        if (!pts) { notify('GeoJSON has no Point features to use as nodes', 'error'); return; }
        fcmLoadGeoJSON(data);
      } else if (Array.isArray(data.nodes)) {
        // FCM JSON mode
        fcmLoadJSON(data);
      } else {
        notify('File must be a FCM JSON (with "nodes") or a GeoJSON FeatureCollection of Points', 'error');
        return;
      }
      fcmRenderPanel();
      if (fcmActive) fcmRenderMap();
      notify(`FCM loaded — ${fcmState.size} nodes, ${fcmEdges.length} edges`, 'success');
    } catch {
      notify('Invalid JSON file', 'error');
    }
  };
  reader.readAsText(file);
}

const fcmFileInput  = document.getElementById('fcm-file-input');
const fcmUploadArea = document.getElementById('fcm-upload-area');

fcmFileInput.addEventListener('change', (e) => {
  handleFcmFile(e.target.files[0]);
  e.target.value = '';
});
fcmUploadArea.addEventListener('dragover',  (e) => { e.preventDefault(); fcmUploadArea.classList.add('drag-over'); });
fcmUploadArea.addEventListener('dragleave', ()  => fcmUploadArea.classList.remove('drag-over'));
fcmUploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  fcmUploadArea.classList.remove('drag-over');
  handleFcmFile(e.dataTransfer.files[0]);
});

// ── Controls ──────────────────────────────────────────────
document.getElementById('fcm-toggle').addEventListener('change', (e) => {
  fcmActive = e.target.checked;
  if (fcmActive) { fcmRenderPanel(); fcmRenderMap(); }
  else           { fcmRenderMap(); if (fcmAnimating) fcmStopAnimate(); }
});

document.getElementById('fcm-reset-btn').addEventListener('click', () => {
  for (const id of fcmState.keys()) fcmState.set(id, FCM_DEFAULT);
  fcmRenderPanel();
  if (fcmActive) fcmRenderMap();
});

document.getElementById('fcm-initial-btn').addEventListener('click', () => {
  for (const [id, v] of fcmInitialState) fcmState.set(id, v);
  fcmRenderPanel();
  if (fcmActive) fcmRenderMap();
});

function fcmStopAnimate() {
  fcmAnimating = false;
  clearInterval(fcmAnimTimer);
  const btn = document.getElementById('fcm-animate-btn');
  if (btn) btn.innerHTML = 'Timeflow <span class="timeflow-info-icon">ⓘ<span class="timeflow-tooltip">Propagates values forward through the causal network step by step, showing how an initial state ripples through connected nodes and converges to a system equilibrium.</span></span>';
}

document.getElementById('fcm-animate-btn').addEventListener('click', () => {
  if (!fcmLoaded) { notify('Load an FCM JSON first', 'info'); return; }
  if (!fcmActive) { notify('Enable FCM mode first', 'info'); return; }
  fcmAnimating = !fcmAnimating;
  document.getElementById('fcm-animate-btn').innerHTML = fcmAnimating ? 'Stop' : 'Timeflow <span class="timeflow-info-icon">ⓘ<span class="timeflow-tooltip">Propagates values forward through the causal network step by step, showing how an initial state ripples through connected nodes and converges to a system equilibrium.</span></span>';
  if (fcmAnimating) {
    fcmAnimTimer = setInterval(() => {
      if (!fcmStep()) { fcmStopAnimate(); notify('FCM converged', 'success'); return; }
      fcmRenderPanel();
      fcmRenderMap();
    }, 350);
  } else {
    fcmStopAnimate();
  }
});

document.getElementById('fcm-reload-btn').addEventListener('click', () => {
  document.getElementById('fcm-file-input').click();
});

document.getElementById('fcm-flyto-btn').addEventListener('click', () => {
  if (!fcmLoaded || fcmDataSource.entities.values.length === 0) return;
  viewer.flyTo(fcmDataSource, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 0),
  });
});

document.querySelector('.side-tab[data-tab="fcm"]')?.addEventListener('click', fcmRenderPanel);

console.log('%cFCM module loaded', 'color:#8b5cf6;font-weight:bold');
