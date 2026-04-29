import * as THREE from "https://unpkg.com/three@0.162.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.162.0/examples/jsm/controls/OrbitControls.js";

const view3d = document.getElementById("view3d");
const wavesContainer = document.getElementById("wavesContainer");
const addWaveBtn = document.getElementById("addWaveBtn");
const timeScaleInput = document.getElementById("timeScale");
const timeScaleValue = document.getElementById("timeScaleValue");
const sliceAngleInput = document.getElementById("sliceAngle");
const sliceAngleValue = document.getElementById("sliceAngleValue");
const presetNameInput = document.getElementById("presetName");
const savePresetBtn = document.getElementById("savePresetBtn");
const presetSelect = document.getElementById("presetSelect");
const loadPresetBtn = document.getElementById("loadPresetBtn");
const deletePresetBtn = document.getElementById("deletePresetBtn");
const sliceCanvas = document.getElementById("sliceCanvas");
const sliceInfo = document.getElementById("sliceInfo");
const sliceCtx = sliceCanvas.getContext("2d");

const WATER_SIZE = 60;
const SEGMENTS = 120;
const HALF = WATER_SIZE / 2;
const SAMPLE_COUNT = 180;
const PRESET_STORAGE_KEY = "wave-interference-presets-v1";
const WAVE_COLORS = [0xff6b6b, 0x4dabf7, 0x51cf66, 0xf59f00, 0xbe4bdb, 0x22b8cf, 0xf06595];
const HEX_COLORS = WAVE_COLORS.map((c) => `#${c.toString(16).padStart(6, "0")}`);

let timeScale = 1;
let waves = [];
let waveIdCounter = 1;
let elapsed = 0;
let sliceAngleDeg = 0;
let presets = {};
const waveControlRefs = new Map();
let draggedWaveId = null;
const openedWaveIds = new Set([1]);
let sliceCanvasCssWidth = 0;
let sliceCanvasCssHeight = 0;

const slicePoint = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let intersectionPlane;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1ede6);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
camera.position.set(40, 36, 38);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
view3d.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xf6f4ee, 0xd6d9d0, 0.95));
const dir = new THREE.DirectionalLight(0xffffff, 0.85);
dir.position.set(24, 36, 18);
scene.add(dir);

const waterGeometry = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, SEGMENTS, SEGMENTS);
waterGeometry.rotateX(-Math.PI / 2);
const waterMaterial = new THREE.MeshStandardMaterial({
  color: 0x8ea8b0,
  roughness: 0.34,
  metalness: 0.08,
  wireframe: false,
  transparent: true,
  opacity: 0.42
});
const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
scene.add(waterMesh);

const wire = new THREE.LineSegments(
  new THREE.WireframeGeometry(waterGeometry),
  new THREE.LineBasicMaterial({ color: 0xa6afa3, transparent: true, opacity: 0.2 })
);
scene.add(wire);

const grid = new THREE.GridHelper(WATER_SIZE, 20, 0xb7c2b3, 0xd4dbcf);
scene.add(grid);

const probeMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.8, 18, 18),
  new THREE.MeshBasicMaterial({ color: 0xffd166 })
);
scene.add(probeMarker);

const sliceBand = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 3.4),
  new THREE.MeshBasicMaterial({
    color: 0x6f8f76,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false
  })
);
sliceBand.renderOrder = 3;
scene.add(sliceBand);
const sliceIntersectionGeometry = new THREE.BufferGeometry();
const sliceIntersectionLine = new THREE.Line(
  sliceIntersectionGeometry,
  new THREE.LineBasicMaterial({ color: 0x2f3730, transparent: true, opacity: 0.95 })
);
sliceIntersectionLine.renderOrder = 4;
scene.add(sliceIntersectionLine);
const sourceMarkers = new THREE.Group();
scene.add(sourceMarkers);
const sourceMarkerGeometry = createTeardropGeometry();

function createWave(defaults = {}) {
  return {
    id: waveIdCounter++,
    amplitude: defaults.amplitude ?? 1.2,
    wavelength: defaults.wavelength ?? 12,
    speed: defaults.speed ?? 1.6,
    phase: defaults.phase ?? 0,
    sourceX: defaults.sourceX ?? (Math.random() * 2 - 1) * 18,
    sourceZ: defaults.sourceZ ?? (Math.random() * 2 - 1) * 18,
    colorIndex: defaults.colorIndex ?? 0
  };
}

waves.push(
  createWave({ amplitude: 1.2, wavelength: 10, speed: 2.0, phase: 0, sourceX: -25, sourceZ: 0, colorIndex: 0 }),
  createWave({ amplitude: 1.2, wavelength: 10, speed: 2.0, phase: 0, sourceX: 25, sourceZ: 0, colorIndex: 1 })
);

function getWaveColorHex(wave) {
  return HEX_COLORS[wave.colorIndex % HEX_COLORS.length];
}

function getWaveColorNumber(wave) {
  return WAVE_COLORS[wave.colorIndex % WAVE_COLORS.length];
}

function getSliceEndpoints() {
  const theta = (sliceAngleDeg * Math.PI) / 180;
  const dx = Math.cos(theta);
  const dz = Math.sin(theta);
  let tMax = Infinity;
  if (Math.abs(dx) > 0.0001) tMax = Math.min(tMax, HALF / Math.abs(dx));
  if (Math.abs(dz) > 0.0001) tMax = Math.min(tMax, HALF / Math.abs(dz));
  if (!Number.isFinite(tMax)) tMax = HALF;

  const x1 = THREE.MathUtils.clamp(slicePoint.x - dx * tMax, -HALF, HALF);
  const z1 = THREE.MathUtils.clamp(slicePoint.y - dz * tMax, -HALF, HALF);
  const x2 = THREE.MathUtils.clamp(slicePoint.x + dx * tMax, -HALF, HALF);
  const z2 = THREE.MathUtils.clamp(slicePoint.y + dz * tMax, -HALF, HALF);
  return [
    new THREE.Vector3(x1, 0.05, z1),
    new THREE.Vector3(x2, 0.05, z2)
  ];
}

function updateSliceLine() {
  const [p1, p2] = getSliceEndpoints();
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const angle = Math.atan2(dz, dx);

  sliceBand.position.set((p1.x + p2.x) * 0.5, 1.7, (p1.z + p2.z) * 0.5);
  sliceBand.scale.set(length, 1, 1);
  sliceBand.rotation.set(0, -angle, 0);
}

function updateSliceIntersection(t) {
  const [start, end] = getSliceEndpoints();
  const dir = new THREE.Vector3().subVectors(end, start);
  const points = [];

  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const ratio = i / (SAMPLE_COUNT - 1);
    const x = start.x + dir.x * ratio;
    const z = start.z + dir.z * ratio;
    const y = computeHeight(x, z, t);
    points.push(new THREE.Vector3(x, y, z));
  }

  sliceIntersectionGeometry.setFromPoints(points);
}

function computeContribution(wave, x, z, t) {
  const dx = x - wave.sourceX;
  const dz = z - wave.sourceZ;
  const r = Math.sqrt(dx * dx + dz * dz) + 0.0001;
  const k = (Math.PI * 2) / wave.wavelength;
  const omega = k * wave.speed;
  return wave.amplitude * Math.sin(k * r - omega * t + wave.phase) / (1 + r * 0.045);
}

function createTeardropGeometry() {
  const profile = [];
  const steps = 30;
  const baseRadius = 0.42;
  const joinY = 0.72;
  const tipY = 1.9;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    let y;
    let radius;
    if (t < 0.5) {
      // 下側: 円弧キャップにして先端化を防ぐ
      const u = t / 0.5;
      y = joinY * u;
      radius = baseRadius * Math.sqrt(Math.max(0, 1 - Math.pow(u - 1, 2)));
    } else {
      // 上側: 直線的に先端へ絞る（鋭角）
      const u = (t - 0.5) / 0.5;
      y = joinY + (tipY - joinY) * u;
      radius = baseRadius * (1 - u);
    }
    profile.push(new THREE.Vector2(Math.max(0.0001, radius), y));
  }
  const geometry = new THREE.LatheGeometry(profile, 26);
  geometry.translate(0, -0.2, 0);
  return geometry;
}

function rebuildSourceMarkers() {
  sourceMarkers.clear();
  for (const wave of waves) {
    const marker = new THREE.Mesh(
      sourceMarkerGeometry,
      new THREE.MeshStandardMaterial({ color: getWaveColorNumber(wave), emissive: 0x0a0a0a })
    );
    marker.position.set(wave.sourceX, 0.75, wave.sourceZ);
    marker.userData.waveId = wave.id;
    sourceMarkers.add(marker);
  }
}

function updateWaveSourceControls(wave) {
  const refs = waveControlRefs.get(wave.id);
  if (!refs) return;
  refs.sourceXInput.value = String(wave.sourceX);
  refs.sourceXValue.textContent = Number(wave.sourceX).toFixed(2);
  refs.sourceZInput.value = String(wave.sourceZ);
  refs.sourceZValue.textContent = Number(wave.sourceZ).toFixed(2);
  setRangeProgress(refs.sourceXInput);
  setRangeProgress(refs.sourceZInput);
}

function computeHeight(x, z, t) {
  let y = 0;
  for (const wave of waves) {
    y += computeContribution(wave, x, z, t);
  }
  return y;
}

function updateWaterSurface(t) {
  const pos = waterGeometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = computeHeight(x, z, t);
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  waterGeometry.computeVertexNormals();

  const wirePos = wire.geometry.attributes.position;
  for (let i = 0; i < wirePos.count; i += 1) {
    const x = wirePos.getX(i);
    const z = wirePos.getZ(i);
    wirePos.setY(i, computeHeight(x, z, t));
  }
  wirePos.needsUpdate = true;
}

function updateProbe(t) {
  const y = computeHeight(slicePoint.x, slicePoint.y, t);
  probeMarker.position.set(slicePoint.x, y, slicePoint.y);
  for (let i = 0; i < sourceMarkers.children.length; i += 1) {
    const mesh = sourceMarkers.children[i];
    const wave = waves.find((w) => w.id === mesh.userData.waveId);
    if (!wave) continue;
    mesh.position.x = wave.sourceX;
    mesh.position.z = wave.sourceZ;
  }
}

function drawSlice(t) {
  const rect = sliceCanvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);

  if (w !== sliceCanvasCssWidth || h !== sliceCanvasCssHeight) {
    resizeSliceCanvas();
  }

  sliceCtx.clearRect(0, 0, w, h);

  sliceCtx.strokeStyle = "#cfd5ca";
  sliceCtx.lineWidth = 1;
  sliceCtx.beginPath();
  sliceCtx.moveTo(0, h / 2);
  sliceCtx.lineTo(w, h / 2);
  sliceCtx.stroke();

  const [start, end] = getSliceEndpoints();
  const dir = new THREE.Vector3().subVectors(end, start);
  const totalSamples = [];
  const perWaveSamples = waves.map(() => []);
  let maxAbs = 0.01;

  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const ratio = i / (SAMPLE_COUNT - 1);
    const x = start.x + dir.x * ratio;
    const z = start.z + dir.z * ratio;
    let total = 0;
    for (let wi = 0; wi < waves.length; wi += 1) {
      const c = computeContribution(waves[wi], x, z, t);
      perWaveSamples[wi].push(c);
      total += c;
    }
    totalSamples.push(total);
    maxAbs = Math.max(maxAbs, Math.abs(total));
  }

  for (let wi = 0; wi < perWaveSamples.length; wi += 1) {
    sliceCtx.strokeStyle = getWaveColorHex(waves[wi]);
    sliceCtx.lineWidth = 1.35;
    sliceCtx.beginPath();
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const x = (i / (SAMPLE_COUNT - 1)) * w;
      const normalized = perWaveSamples[wi][i] / maxAbs;
      const y = h * 0.5 - normalized * (h * 0.38);
      if (i === 0) sliceCtx.moveTo(x, y);
      else sliceCtx.lineTo(x, y);
    }
    sliceCtx.stroke();
  }

  sliceCtx.strokeStyle = "#666c65";
  sliceCtx.lineWidth = 2;
  sliceCtx.beginPath();
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const x = (i / (SAMPLE_COUNT - 1)) * w;
    const normalized = totalSamples[i] / maxAbs;
    const y = h * 0.5 - normalized * (h * 0.38);
    if (i === 0) sliceCtx.moveTo(x, y);
    else sliceCtx.lineTo(x, y);
  }
  sliceCtx.stroke();

  sliceCtx.font = "500 11px 'JetBrains Mono', monospace";
  sliceCtx.fillStyle = "#7f857e";
  sliceCtx.fillText("黒線: 合成波  /  色線: 各波の寄与", 10, 16);

  // 波源位置を断面線へ射影して、グラフ下部にマーカー表示
  const line2D = new THREE.Vector2(end.x - start.x, end.z - start.z);
  const lineLenSq = line2D.lengthSq() || 1;
  const markerBaseY = h - 16;
  for (let wi = 0; wi < waves.length; wi += 1) {
    const wave = waves[wi];
    const rel = new THREE.Vector2(wave.sourceX - start.x, wave.sourceZ - start.z);
    let t = rel.dot(line2D) / lineLenSq;
    t = THREE.MathUtils.clamp(t, 0, 1);
    const markerX = t * w;
    const color = getWaveColorHex(wave);

    sliceCtx.strokeStyle = color;
    sliceCtx.lineWidth = 1;
    sliceCtx.beginPath();
    sliceCtx.moveTo(markerX, 20);
    sliceCtx.lineTo(markerX, markerBaseY);
    sliceCtx.stroke();

    sliceCtx.fillStyle = color;
    sliceCtx.beginPath();
    sliceCtx.moveTo(markerX, 9);
    sliceCtx.bezierCurveTo(markerX + 4, 12, markerX + 4, 17, markerX, 19);
    sliceCtx.bezierCurveTo(markerX - 4, 17, markerX - 4, 12, markerX, 9);
    sliceCtx.closePath();
    sliceCtx.fill();
  }

  // 3D上の黄色い観測球（slicePoint）を断面グラフ上に重ね描画
  const probeRel = new THREE.Vector2(slicePoint.x - start.x, slicePoint.y - start.z);
  let probeT = probeRel.dot(line2D) / lineLenSq;
  probeT = THREE.MathUtils.clamp(probeT, 0, 1);
  const probeX = probeT * w;
  const probeHeight = computeHeight(slicePoint.x, slicePoint.y, t);
  const probeY = h * 0.5 - (probeHeight / maxAbs) * (h * 0.38);

  sliceCtx.strokeStyle = "rgba(232, 179, 22, 0.45)";
  sliceCtx.lineWidth = 1;
  sliceCtx.beginPath();
  sliceCtx.moveTo(probeX, 20);
  sliceCtx.lineTo(probeX, h - 6);
  sliceCtx.stroke();

  sliceCtx.fillStyle = "#ffd166";
  sliceCtx.shadowColor = "rgba(120, 98, 24, 0.52)";
  sliceCtx.shadowBlur = 8;
  sliceCtx.shadowOffsetX = 0;
  sliceCtx.shadowOffsetY = 2;
  sliceCtx.beginPath();
  sliceCtx.arc(probeX, probeY, 5, 0, Math.PI * 2);
  sliceCtx.fill();
  sliceCtx.shadowColor = "transparent";
  sliceCtx.strokeStyle = "#ffffff";
  sliceCtx.lineWidth = 2;
  sliceCtx.stroke();

  sliceInfo.textContent = `断面中心: (X=${slicePoint.x.toFixed(2)}, Z=${slicePoint.y.toFixed(2)}) / 角度: ${sliceAngleDeg.toFixed(0)}°`;
}

function resizeSliceCanvas() {
  const rect = sliceCanvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  sliceCanvas.width = Math.round(cssWidth * dpr);
  sliceCanvas.height = Math.round(cssHeight * dpr);
  sliceCanvasCssWidth = cssWidth;
  sliceCanvasCssHeight = cssHeight;
  sliceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function setRangeProgress(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || 0);
  const ratio = max === min ? 0 : (value - min) / (max - min);
  const percentage = THREE.MathUtils.clamp(ratio, 0, 1) * 100;
  input.style.setProperty("--progress", `${percentage}%`);
}

function createSlider(label, min, max, step, value, onInput) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const row = document.createElement("div");
  row.className = "value-row";
  const current = document.createElement("span");
  current.textContent = Number(value).toFixed(2);
  row.appendChild(current);
  input.addEventListener("input", () => {
    const num = Number(input.value);
    current.textContent = num.toFixed(2);
    setRangeProgress(input);
    onInput(num);
  });
  setRangeProgress(input);
  wrap.append(input, row);
  wrap._input = input;
  wrap._valueText = current;
  return wrap;
}

function renderWaveControls() {
  const previousOpenIds = new Set(openedWaveIds);
  wavesContainer.innerHTML = "";
  waveControlRefs.clear();
  openedWaveIds.clear();
  waves.forEach((wave, index) => {
    const card = document.createElement("div");
    card.className = "wave-card";

    const accordion = document.createElement("details");
    accordion.open = previousOpenIds.has(wave.id);
    if (accordion.open) openedWaveIds.add(wave.id);
    accordion.addEventListener("toggle", () => {
      if (accordion.open) openedWaveIds.add(wave.id);
      else openedWaveIds.delete(wave.id);
    });

    const summary = document.createElement("summary");
    summary.className = "wave-head";

    const head = document.createElement("div");
    const title = document.createElement("strong");
    const dot = document.createElement("span");
    dot.className = "wave-color-dot";
    dot.style.background = getWaveColorHex(wave);
    title.append(dot, document.createTextNode(`波 ${index + 1}`));
    const remove = document.createElement("button");
    remove.className = "remove-wave";
    remove.type = "button";
    remove.textContent = "✕";
    remove.disabled = waves.length === 1;
    remove.addEventListener("click", () => {
      waves = waves.filter((w) => w.id !== wave.id);
      renderWaveControls();
    });
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    head.append(title);
    summary.append(head, remove);
    accordion.append(summary);

    const content = document.createElement("div");
    content.className = "wave-content";

    const ampSlider = createSlider("振幅", 0.2, 3.0, 0.01, wave.amplitude, (v) => (wave.amplitude = v));
    const wavelengthSlider = createSlider("波長", 3, 30, 0.1, wave.wavelength, (v) => (wave.wavelength = v));
    const speedSlider = createSlider("速度", 0.2, 4.0, 0.01, wave.speed, (v) => (wave.speed = v));
    const phaseSlider = createSlider("位相", 0, Math.PI * 2, 0.01, wave.phase, (v) => (wave.phase = v));
    const sourceXSlider = createSlider("発生源X", -HALF, HALF, 0.1, wave.sourceX, (v) => (wave.sourceX = v));
    const sourceZSlider = createSlider("発生源Z", -HALF, HALF, 0.1, wave.sourceZ, (v) => (wave.sourceZ = v));
    content.append(ampSlider, wavelengthSlider, speedSlider, phaseSlider, sourceXSlider, sourceZSlider);

    waveControlRefs.set(wave.id, {
      sourceXInput: sourceXSlider._input,
      sourceXValue: sourceXSlider._valueText,
      sourceZInput: sourceZSlider._input,
      sourceZValue: sourceZSlider._valueText
    });
    accordion.append(content);
    card.append(accordion);

    wavesContainer.append(card);
  });
  rebuildSourceMarkers();
}

function resize() {
  const rect = view3d.getBoundingClientRect();
  const width = Math.max(100, rect.width);
  const height = Math.max(100, rect.height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  resizeSliceCanvas();
}

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const sourceHit = raycaster.intersectObjects(sourceMarkers.children, false)[0];
  if (sourceHit) {
    draggedWaveId = sourceHit.object.userData.waveId;
    controls.enabled = false;
    return;
  }

  const hit = raycaster.intersectObject(intersectionPlane, false)[0];
  if (!hit) return;

  slicePoint.x = THREE.MathUtils.clamp(hit.point.x, -HALF, HALF);
  slicePoint.y = THREE.MathUtils.clamp(hit.point.z, -HALF, HALF);
  updateSliceLine();
}

function onPointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const sourceHit = raycaster.intersectObjects(sourceMarkers.children, false)[0];

  if (draggedWaveId == null) {
    renderer.domElement.style.cursor = sourceHit ? "pointer" : "";
    return;
  }

  const hit = raycaster.intersectObject(intersectionPlane, false)[0];
  if (!hit) return;

  const wave = waves.find((w) => w.id === draggedWaveId);
  if (!wave) return;
  wave.sourceX = THREE.MathUtils.clamp(hit.point.x, -HALF, HALF);
  wave.sourceZ = THREE.MathUtils.clamp(hit.point.z, -HALF, HALF);
  renderer.domElement.style.cursor = "grabbing";
  updateWaveSourceControls(wave);
}

function onPointerUp() {
  if (draggedWaveId == null) return;
  draggedWaveId = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = "";
}

function animate(nowMs) {
  const now = nowMs * 0.001;
  elapsed += (now - (animate.prevTime || now)) * timeScale;
  animate.prevTime = now;

  updateWaterSurface(elapsed);
  updateProbe(elapsed);
  updateSliceIntersection(elapsed);
  drawSlice(elapsed);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function serializeState() {
  return {
    timeScale,
    sliceAngleDeg,
    slicePoint: { x: slicePoint.x, z: slicePoint.y },
    waves: waves.map((wave) => ({
      amplitude: wave.amplitude,
      wavelength: wave.wavelength,
      speed: wave.speed,
      phase: wave.phase,
      sourceX: wave.sourceX,
      sourceZ: wave.sourceZ,
      colorIndex: wave.colorIndex
    }))
  };
}

function applyState(state) {
  if (!state || !Array.isArray(state.waves) || state.waves.length === 0) return;

  timeScale = Number(state.timeScale ?? 1);
  sliceAngleDeg = Number(state.sliceAngleDeg ?? 0);
  slicePoint.x = THREE.MathUtils.clamp(Number(state.slicePoint?.x ?? 0), -HALF, HALF);
  slicePoint.y = THREE.MathUtils.clamp(Number(state.slicePoint?.z ?? 0), -HALF, HALF);

  waves = state.waves.map((w, i) =>
    createWave({
      amplitude: Number(w.amplitude ?? 1),
      wavelength: Number(w.wavelength ?? 12),
      speed: Number(w.speed ?? 1.6),
      phase: Number(w.phase ?? 0),
      sourceX: Number(w.sourceX ?? 0),
      sourceZ: Number(w.sourceZ ?? 0),
      colorIndex: Number(w.colorIndex ?? i % WAVE_COLORS.length)
    })
  );

  timeScaleInput.value = String(timeScale);
  timeScaleValue.textContent = timeScale.toFixed(2);
  sliceAngleInput.value = String(sliceAngleDeg);
  sliceAngleValue.textContent = `${sliceAngleDeg.toFixed(0)}°`;
  renderWaveControls();
  updateSliceLine();
}

function loadPresets() {
  try {
    presets = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || "{}");
  } catch {
    presets = {};
  }
  presetSelect.innerHTML = '<option value="">保存済みプリセットを選択</option>';
  Object.keys(presets)
    .sort()
    .forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      presetSelect.appendChild(option);
    });
}

function savePreset() {
  const name = presetNameInput.value.trim();
  if (!name) {
    alert("プリセット名を入力してください。");
    return;
  }
  presets[name] = serializeState();
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
  loadPresets();
  presetSelect.value = name;
}

function loadPreset() {
  const name = presetSelect.value;
  if (!name || !presets[name]) return;
  applyState(presets[name]);
}

function deletePreset() {
  const name = presetSelect.value;
  if (!name || !presets[name]) return;
  delete presets[name];
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
  loadPresets();
}

intersectionPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE),
  new THREE.MeshBasicMaterial({ visible: false })
);
intersectionPlane.rotateX(-Math.PI / 2);
scene.add(intersectionPlane);

addWaveBtn.addEventListener("click", () => {
  waves.push(createWave({ colorIndex: waves.length % WAVE_COLORS.length }));
  renderWaveControls();
});

timeScaleInput.addEventListener("input", () => {
  timeScale = Number(timeScaleInput.value);
  timeScaleValue.textContent = timeScale.toFixed(2);
  setRangeProgress(timeScaleInput);
});

sliceAngleInput.addEventListener("input", () => {
  sliceAngleDeg = Number(sliceAngleInput.value);
  sliceAngleValue.textContent = `${sliceAngleDeg.toFixed(0)}°`;
  setRangeProgress(sliceAngleInput);
  updateSliceLine();
});

savePresetBtn.addEventListener("click", savePreset);
loadPresetBtn.addEventListener("click", loadPreset);
deletePresetBtn.addEventListener("click", deletePreset);

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", onPointerUp);
renderer.domElement.addEventListener("pointerleave", onPointerUp);
window.addEventListener("resize", resize);

renderWaveControls();
loadPresets();
setRangeProgress(timeScaleInput);
setRangeProgress(sliceAngleInput);
updateSliceLine();
resize();
requestAnimationFrame(animate);
