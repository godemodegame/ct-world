import './styles.css';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LOCATIONS, NPCS, QUESTS, WALE_MOCA } from './data/gameData.js';

const MAP_TILE_WIDTH = 48;
const MAP_VISIBLE_TILES = 12;
const HERO_SPEED = 9;
const INTERACTION_DISTANCE = 2.6;
const HERO_ASSETS = ['/assets/hero.fbx', '/assets/hero.glb', '/assets/hero.gltf'];
const HERO_TARGET_HEIGHT = 2.4;
const NPC_TARGET_HEIGHT = 2.1;
const MODEL_FACE_DOWN_OFFSET = Math.PI / 2;
const MAP_ASSET = '/assets/map.png';
const QUEST_STORAGE_KEY = 'ct-world.friesForJessy';
const LEGACY_QUEST_STORAGE_KEY = 'kris-rpg.friesForJessy';

const app = document.querySelector('#app');
const status = document.querySelector('#status');
const questChip = document.querySelector('#questChip');
const socialPanel = document.querySelector('#socialPanel');
const socialToggle = document.querySelector('#socialToggle');
const feedList = document.querySelector('#feedList');
const dialogPanel = document.querySelector('#dialogPanel');
const dialogName = document.querySelector('#dialogName');
const dialogText = document.querySelector('#dialogText');
const dialogClose = document.querySelector('#dialogClose');
const dialogSecondary = document.querySelector('#dialogSecondary');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8db6c7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const camera = new THREE.OrthographicCamera(-16, 16, 9, -9, 0.1, 200);
const cameraOffset = new THREE.Vector3(0, 26, 18);
camera.position.copy(cameraOffset);
camera.lookAt(0, 0, 0);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();

const targetPosition = new THREE.Vector3(0, 0, 0);
const heroVelocity = new THREE.Vector3();
let mapTileDepth = 32;
let hero;
let heroMixer;
let walkAction;
let idleAction;
let currentAction;
const npcMixers = [];
let isMoving = false;
let pendingInteraction = null;
let dialogPrimaryAction = null;
let dialogSecondaryAction = null;

const interactiveRoots = [];
const outsideGroup = new THREE.Group();
outsideGroup.name = 'Outside';
scene.add(outsideGroup);

const interiorGroup = new THREE.Group();
interiorGroup.name = "McDonald's Interior";
interiorGroup.visible = false;
scene.add(interiorGroup);

const gameState = {
  activeQuestId: null,
  questStage: 'not_started',
  inventory: new Set(),
  feed: [],
  world: 'outside',
  friesReadyAt: 0,
};
loadQuestState();

const map = createMap();
outsideGroup.add(map);

const locations = createLocations();
const npcs = createNPCs();
const interior = createMcDonaldsInterior();

const clickMarker = createClickMarker();
clickMarker.visible = false;
scene.add(clickMarker);

createLighting();
loadHero();
seedFeed();
updateQuestUI();
updateQuestMarkers();
resize();
renderer.setAnimationLoop(tick);

window.addEventListener('resize', resize);
renderer.domElement.addEventListener('pointerdown', handlePointerDown);
dialogClose.addEventListener('click', () => {
  const action = dialogPrimaryAction;
  dialogPanel.hidden = true;
  clearDialogActions();
  if (action) action();
});
dialogSecondary.addEventListener('click', () => {
  const action = dialogSecondaryAction;
  dialogPanel.hidden = true;
  clearDialogActions();
  if (action) action();
});
socialToggle?.addEventListener('click', toggleSocialPanel);

function setStatus(message) {
  if (status) status.textContent = message;
}

function toggleSocialPanel() {
  const isCollapsed = socialPanel?.classList.toggle('is-collapsed') ?? false;
  socialToggle.setAttribute('aria-expanded', String(!isCollapsed));
  socialToggle.setAttribute('aria-label', isCollapsed ? 'Expand timeline' : 'Collapse timeline');
  socialToggle.textContent = isCollapsed ? 'Show' : 'Hide';
}

function loadQuestState() {
  const saved = JSON.parse(
    localStorage.getItem(QUEST_STORAGE_KEY)
      || localStorage.getItem(LEGACY_QUEST_STORAGE_KEY)
      || '{}'
  );
  if (saved.activeQuestId) gameState.activeQuestId = saved.activeQuestId;
  if (saved.questStage) gameState.questStage = saved.questStage;
  if (Number.isFinite(saved.friesReadyAt)) gameState.friesReadyAt = saved.friesReadyAt;
}

function saveQuestState() {
  localStorage.setItem(QUEST_STORAGE_KEY, JSON.stringify({
    activeQuestId: gameState.activeQuestId,
    questStage: gameState.questStage,
    friesReadyAt: gameState.friesReadyAt,
  }));
}

function createLighting() {
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(15, 25, 12);
  sun.castShadow = true;
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  const ambient = new THREE.HemisphereLight(0xcfefff, 0x3f6a4a, 1.8);
  scene.add(ambient);
}

function createNPCs() {
  const npcMap = new Map();

  NPCS.forEach((npc) => {
    const group = new THREE.Group();
    group.name = npc.displayName;
    group.position.set(npc.position.x, 0, npc.position.z);
    group.userData.interactive = { kind: 'npc', id: npc.id, world: 'outside' };

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 32),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.18 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.035;
    group.add(shadow);

    const fallbackVisual = createFallbackNPCVisual(npc);
    group.add(fallbackVisual);

    const questMarker = createQuestMarkerSprite('?');
    questMarker.position.set(0, 3.72, 0);
    questMarker.userData.baseScale = questMarker.scale.clone();
    group.userData.questMarker = questMarker;
    group.add(questMarker);

    const label = createLabelSprite(npc.handle, {
      background: 'rgba(15, 23, 32, 0.82)',
      color: '#ffffff',
    });
    label.position.set(0, 2.56, 0);
    group.add(label);

    if (npc.model) {
      loadNPCModel(npc.model, group, fallbackVisual, npc.texture);
    }

    outsideGroup.add(group);
    interactiveRoots.push(group);
    npcMap.set(npc.id, group);
  });

  return npcMap;
}

function createFallbackNPCVisual(npc) {
  const group = new THREE.Group();
  group.name = `${npc.displayName} Fallback`;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: npc.color,
    roughness: 0.62,
  });
  const hoodieMaterial = new THREE.MeshStandardMaterial({
    color: 0x202734,
    roughness: 0.7,
  });
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: 0xf3c6ad,
    roughness: 0.58,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.72, 6, 16), bodyMaterial);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  const jacket = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 8, 28), hoodieMaterial);
  jacket.position.y = 1.22;
  jacket.rotation.x = Math.PI / 2;
  jacket.castShadow = true;
  group.add(jacket);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), faceMaterial);
  head.position.y = 1.7;
  head.castShadow = true;
  group.add(head);

  return group;
}

function loadNPCModel(asset, group, fallbackVisual, textureAsset) {
  const loader = createHeroLoader(asset);
  const texture = textureAsset ? loadCharacterTexture(textureAsset) : null;
  loader.load(
    asset,
    (loaded) => {
      const model = loaded.scene || loaded;
      prepareModel(model, NPC_TARGET_HEIGHT);
      if (texture) applyTextureToModel(model, texture);
      model.rotation.y = Math.PI + MODEL_FACE_DOWN_OFFSET;
      playNPCIdleAnimation(model, loaded.animations);
      group.remove(fallbackVisual);
      group.add(model);
    },
    undefined,
    () => {
      setStatus(`Could not load ${asset.split('/').pop()}`);
    }
  );
}

function loadCharacterTexture(asset) {
  const texture = new THREE.TextureLoader().load(asset);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function applyTextureToModel(model, texture) {
  model.traverse((child) => {
    if (!child.isMesh || !child.material) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.map = texture;
      material.color?.set(0xffffff);
      material.roughness = Math.min(material.roughness ?? 0.7, 0.78);
      material.needsUpdate = true;
    });
  });
}

function createLocations() {
  const locationMap = new Map();

  LOCATIONS.forEach((location) => {
    const group = new THREE.Group();
    group.name = location.displayName;
    group.position.set(location.position.x, 0, location.position.z);
    group.userData.interactive = { kind: 'location', id: location.id, world: 'outside' };

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 1.55, 2.8),
      new THREE.MeshStandardMaterial({ color: location.color, roughness: 0.66 })
    );
    base.position.y = 0.78;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(4.05, 0.38, 3.18),
      new THREE.MeshStandardMaterial({ color: 0x2b1f1c, roughness: 0.7 })
    );
    roof.position.y = 1.73;
    roof.castShadow = true;
    group.add(roof);

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.62, 0.12),
      new THREE.MeshStandardMaterial({ color: location.accentColor, roughness: 0.5 })
    );
    sign.position.set(0, 1.22, 1.46);
    sign.castShadow = true;
    group.add(sign);

    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(2.25, 0.62, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xf5f0dd, roughness: 0.74 })
    );
    counter.position.set(0, 0.47, 1.52);
    counter.castShadow = true;
    group.add(counter);

    const label = createLabelSprite(location.displayName, {
      background: 'rgba(217, 40, 30, 0.88)',
      color: '#fff3c4',
    });
    label.position.set(0, 2.42, 0);
    group.add(label);

    outsideGroup.add(group);
    interactiveRoots.push(group);
    locationMap.set(location.id, group);
  });

  return locationMap;
}

function createMcDonaldsInterior() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 14, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xeadfc9, roughness: 0.86 })
  );
  floor.name = "McDonald's Interior Floor";
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  interiorGroup.add(floor);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(18, 3, 0.32),
    new THREE.MeshStandardMaterial({ color: 0xb82018, roughness: 0.72 })
  );
  backWall.position.set(0, 1.5, -6.8);
  backWall.receiveShadow = true;
  interiorGroup.add(backWall);

  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(9, 1.1, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x2d2420, roughness: 0.68 })
  );
  counter.position.set(0, 0.55, -3.2);
  counter.castShadow = true;
  counter.receiveShadow = true;
  interiorGroup.add(counter);

  const sign = createLabelSprite("McDonald's", {
    background: 'rgba(217, 40, 30, 0.92)',
    color: '#fff3c4',
  });
  sign.position.set(0, 3.35, -6.56);
  interiorGroup.add(sign);

  const cashier = createCashier();
  cashier.position.set(0, 0, -4.15);
  cashier.userData.interactive = { kind: 'cashier', id: 'mcdonalds_cashier', world: 'mcdonaldsInterior' };
  interiorGroup.add(cashier);
  interactiveRoots.push(cashier);

  const exit = createExitMarker();
  exit.position.set(0, 0, 5.1);
  exit.userData.interactive = { kind: 'exit', id: 'mcdonalds_exit', world: 'mcdonaldsInterior' };
  interiorGroup.add(exit);
  interactiveRoots.push(exit);

  return { floor, cashier, exit };
}

function createCashier() {
  const group = new THREE.Group();
  group.name = WALE_MOCA.displayName;

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.36, 0.72, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0xf2d24b, roughness: 0.62 })
  );
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.5, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xb82018, roughness: 0.7 })
  );
  apron.position.set(0, 0.92, 0.34);
  apron.castShadow = true;
  group.add(apron);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xf0bf96, roughness: 0.55 })
  );
  head.position.y = 1.65;
  head.castShadow = true;
  group.add(head);

  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.3, 0.18, 24),
    new THREE.MeshStandardMaterial({ color: 0xd9281e, roughness: 0.6 })
  );
  hat.position.y = 1.96;
  hat.castShadow = true;
  group.add(hat);

  const label = createLabelSprite(WALE_MOCA.handle, {
    background: 'rgba(15, 23, 32, 0.86)',
    color: '#ffffff',
  });
  label.position.set(0, 2.38, 0);
  group.add(label);

  loadCashierModel(group, body, apron, head, hat);

  return group;
}

function loadCashierModel(group, ...fallbackParts) {
  const loader = createHeroLoader(WALE_MOCA.model);
  const texture = loadCharacterTexture(WALE_MOCA.texture);

  loader.load(
    WALE_MOCA.model,
    (loaded) => {
      const model = loaded.scene || loaded;
      prepareModel(model, NPC_TARGET_HEIGHT);
      applyTextureToModel(model, texture);
      model.rotation.y = Math.PI + MODEL_FACE_DOWN_OFFSET;
      playNPCIdleAnimation(model, loaded.animations);
      fallbackParts.forEach((part) => group.remove(part));
      group.add(model);
    },
    undefined,
    () => {
      setStatus(`Could not load ${WALE_MOCA.model.split('/').pop()}`);
    }
  );
}

function createExitMarker() {
  const group = new THREE.Group();
  group.name = 'Exit';

  const mat = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1.05, 48),
    new THREE.MeshBasicMaterial({
      color: 0x1d9bf0,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
    })
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.05;
  group.add(mat);

  const label = createLabelSprite('Exit', {
    background: 'rgba(29, 155, 240, 0.9)',
    color: '#ffffff',
  });
  label.position.set(0, 1.1, 0);
  group.add(label);

  return group;
}

function createLabelSprite(text, options = {}) {
  const paddingX = options.paddingX ?? 24;
  const paddingY = options.paddingY ?? 14;
  const fontSize = options.fontSize ?? 42;
  const font = `760 ${fontSize}px Inter, Arial, sans-serif`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  const metrics = ctx.measureText(text);
  canvas.width = Math.ceil(metrics.width + paddingX * 2);
  canvas.height = fontSize + paddingY * 2;

  ctx.font = font;
  ctx.fillStyle = options.background || 'rgba(12, 17, 22, 0.82)';
  roundRect(ctx, 0, 0, canvas.width, canvas.height, 16);
  ctx.fill();
  ctx.fillStyle = options.color || '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(canvas.width / 110, canvas.height / 110, 1);
  return sprite;
}

function createQuestMarkerSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 190;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 138px Inter, Arial, sans-serif';

  const x = canvas.width / 2;
  const y = canvas.height / 2 - 6;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 10;

  ctx.fillStyle = '#8c6100';
  ctx.fillText(text, x + 6, y + 8);
  ctx.strokeStyle = '#2b1a00';
  ctx.lineWidth = 9;
  ctx.strokeText(text, x + 6, y + 8);

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffc72c';
  ctx.strokeStyle = '#5b3900';
  ctx.lineWidth = 7;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);

  ctx.fillStyle = 'rgba(255, 248, 196, 0.92)';
  ctx.font = '900 138px Inter, Arial, sans-serif';
  ctx.fillText(text, x - 4, y - 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.08, 1.28, 1);
  sprite.userData.markerText = text;
  return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function createMap() {
  const texture = createFallbackMapTexture();
  configureInfiniteTexture(texture);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.9,
    metalness: 0,
  });

  const loader = new THREE.TextureLoader();
  loader.load(
    MAP_ASSET,
    (loadedTexture) => {
      loadedTexture.colorSpace = THREE.SRGBColorSpace;
      loadedTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      configureInfiniteTexture(loadedTexture);
      material.map = loadedTexture;
      material.needsUpdate = true;
      fitInfiniteMapToTexture(plane, loadedTexture);
      setStatus('Map loaded');
    },
    undefined,
    () => {
      setStatus('Click the map');
    }
  );

  const plane = new THREE.Mesh(
    createInfiniteMapGeometry(),
    material
  );
  plane.name = 'Infinite Clickable Map';
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  return plane;
}

function configureInfiniteTexture(texture) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(MAP_VISIBLE_TILES, MAP_VISIBLE_TILES);
}

function createInfiniteMapGeometry() {
  return new THREE.PlaneGeometry(
    MAP_TILE_WIDTH * MAP_VISIBLE_TILES,
    mapTileDepth * MAP_VISIBLE_TILES,
    1,
    1
  );
}

function fitInfiniteMapToTexture(plane, texture) {
  const image = texture.image;
  if (!image?.width || !image?.height) return;

  mapTileDepth = MAP_TILE_WIDTH * (image.height / image.width);
  plane.geometry.dispose();
  plane.geometry = createInfiniteMapGeometry();
  updateMapTextureOffset();
}

function createFallbackMapTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, '#67a568');
  gradient.addColorStop(0.48, '#8ebf73');
  gradient.addColorStop(1, '#4f8c74');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.strokeStyle = 'rgba(24, 71, 42, 0.28)';
  ctx.lineWidth = 4;
  for (let i = 0; i <= 1024; i += 128) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1024);
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(42, 78, 125, 0.28)';
  ctx.beginPath();
  ctx.moveTo(0, 680);
  ctx.bezierCurveTo(250, 590, 420, 760, 650, 680);
  ctx.bezierCurveTo(830, 615, 900, 470, 1024, 510);
  ctx.lineTo(1024, 1024);
  ctx.lineTo(0, 1024);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(50, 82, 45, 0.32)';
  for (let i = 0; i < 95; i += 1) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const r = 10 + Math.random() * 22;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = '600 42px Inter, Arial, sans-serif';
  ctx.fillText('public/assets/map.png', 328, 510);
  ctx.font = '400 28px Inter, Arial, sans-serif';
  ctx.fillText('place your 2D map here', 353, 552);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  configureInfiniteTexture(texture);
  return texture;
}

function loadHero() {
  hero = createFallbackHero();
  scene.add(hero);
  setStatus('Loading model...');

  loadHeroAsset(0);
}

function loadHeroAsset(assetIndex) {
  const asset = HERO_ASSETS[assetIndex];
  if (!asset) {
    setStatus('Click the map');
    return;
  }

  const loader = createHeroLoader(asset);
  loader.load(
    asset,
    (loaded) => applyLoadedHero(loaded, asset),
    undefined,
    () => loadHeroAsset(assetIndex + 1)
  );
}

function createHeroLoader(asset) {
  return asset.endsWith('.fbx') ? new FBXLoader() : new GLTFLoader();
}

function applyLoadedHero(loaded, asset) {
  const model = loaded.scene || loaded;
  const clips = removeRootMotionFromClips(loaded.animations || []);

  scene.remove(hero);
  hero = new THREE.Group();
  hero.name = 'Hero';
  hero.position.set(0, 0, 0);

  prepareModel(model);
  hero.add(model);
  scene.add(hero);

  heroMixer = new THREE.AnimationMixer(model);
  idleAction = findAction(clips, ['idle', 'stand', 'breath']);
  walkAction = findAction(clips, ['walk', 'run']) || clips[0] && heroMixer.clipAction(clips[0]);
  currentAction = undefined;

  setAnimation(false);
  setStatus(`Model loaded: ${asset.split('/').pop()}`);
}

function removeRootMotionFromClips(clips) {
  return clips.map((clip) => {
    const normalized = clip.clone();
    normalized.tracks = normalized.tracks.filter((track) => !isRootPositionTrack(track));
    normalized.resetDuration();
    return normalized;
  });
}

function isRootPositionTrack(track) {
  if (!(track instanceof THREE.VectorKeyframeTrack)) return false;
  if (!track.name.endsWith('.position')) return false;

  const target = track.name.toLowerCase();
  return /(hips|pelvis|root|armature|bip001|mixamorig)/.test(target);
}

function prepareModel(model, targetHeight = HERO_TARGET_HEIGHT) {
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          material.side = THREE.FrontSide;
          material.needsUpdate = true;
        });
      }
    }
  });

  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? targetHeight / size.y : 1;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = scaledBox.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= scaledBox.min.y;
  model.position.z -= center.z;
}

function findAction(clips, names) {
  const clip = findClip(clips, names);
  return clip ? heroMixer.clipAction(clip) : null;
}

function findClip(clips, names) {
  return clips.find((candidate) =>
    names.some((name) => candidate.name.toLowerCase().includes(name))
  );
}

function playNPCIdleAnimation(model, animations = []) {
  const clips = removeRootMotionFromClips(animations);
  if (!clips.length) return;

  const mixer = new THREE.AnimationMixer(model);
  const clip = findClip(clips, ['idle', 'stand', 'breath']) || clips[0];
  mixer.clipAction(clip).play();
  npcMixers.push(mixer);
}

function createFallbackHero() {
  const group = new THREE.Group();
  group.name = 'Fallback Hero';

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2c6fd1, roughness: 0.55 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c8a2, roughness: 0.55 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.85, 6, 16), bodyMaterial);
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 16), headMaterial);
  head.position.y = 1.95;
  head.castShadow = true;
  group.add(head);

  const direction = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.48, 24), accentMaterial);
  direction.rotation.x = Math.PI / 2;
  direction.position.set(0, 1.18, 0.55);
  direction.castShadow = true;
  group.add(direction);

  return group;
}

function createClickMarker() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  return ring;
}

function handlePointerDown(event) {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const interactiveRoot = raycaster
    .intersectObjects(interactiveRoots, true)
    .map((hit) => findInteractiveRoot(hit.object))
    .find((root) => root && isInteractiveInCurrentWorld(root));
  if (interactiveRoot) {
    approachOrInteract(interactiveRoot);
    return;
  }

  const walkSurface = getWalkSurface();
  const hit = walkSurface && raycaster.intersectObject(walkSurface, false)[0];
  if (!hit || !hero) return;

  pendingInteraction = null;
  moveHeroTo(hit.point);
  setStatus(`Moving: ${targetPosition.x.toFixed(1)}, ${targetPosition.z.toFixed(1)}`);
}

function findInteractiveRoot(object) {
  let current = object;
  while (current) {
    if (current.userData.interactive) return current;
    current = current.parent;
  }
  return null;
}

function isInteractiveInCurrentWorld(root) {
  return root.visible && root.userData.interactive?.world === gameState.world;
}

function getWalkSurface() {
  return gameState.world === 'mcdonaldsInterior' ? interior.floor : map;
}

function approachOrInteract(root) {
  if (!hero) return;
  const distance = flatDistance(hero.position, root.position);
  if (distance <= INTERACTION_DISTANCE) {
    interact(root);
    return;
  }

  pendingInteraction = root;
  const approachPoint = getApproachPoint(root);
  moveHeroTo(approachPoint);
  setStatus(`Walking to ${root.name}`);
}

function getApproachPoint(root) {
  const direction = hero.position.clone().sub(root.position);
  direction.y = 0;
  if (direction.lengthSq() < 0.001) direction.set(1, 0, 1);
  direction.normalize().multiplyScalar(INTERACTION_DISTANCE * 0.58);
  return root.position.clone().add(direction);
}

function moveHeroTo(point) {
  targetPosition.copy(point);
  targetPosition.y = 0;
  clickMarker.position.set(targetPosition.x, 0.05, targetPosition.z);
  clickMarker.visible = true;
  isMoving = true;
}

function flatDistance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function interact(root) {
  const target = root.userData.interactive;
  if (target.kind === 'npc') {
    interactWithNPC(target.id);
    return;
  }

  if (target.kind === 'location') {
    interactWithLocation(target.id);
    return;
  }

  if (target.kind === 'cashier') {
    interactWithCashier();
    return;
  }

  if (target.kind === 'exit') {
    exitMcDonalds();
  }
}

function interactWithNPC(npcId) {
  const npc = NPCS.find((candidate) => candidate.id === npcId);
  if (!npc) return;

  const quest = QUESTS[npc.questId];
  if (!quest) {
    showDialog(npc.displayName, npc.bio);
    return;
  }

  if (!gameState.activeQuestId || gameState.questStage === 'not_started') {
    showDialog(
      npc.displayName,
      "I have a crisis-level request: I need McDonald's fries. Hot ones. Can you get them for me?",
      {
        primaryLabel: 'Accept quest',
        onPrimary: () => acceptQuest(quest, npc),
        secondaryLabel: 'Not now',
      }
    );
    return;
  }

  if (gameState.activeQuestId !== quest.id) {
    showDialog(npc.displayName, 'I see you already have an active quest. Finish that thread first.');
    return;
  }

  if (gameState.questStage === 'accepted') {
    showDialog(npc.displayName, "The McDonald's is on the map. Go inside and order from the cashier.");
    return;
  }

  if (gameState.questStage === 'fries_ordered') {
    showDialog(npc.displayName, 'You ordered them? Perfect. We respect the process. Come back when the bag exists.');
    return;
  }

  if (gameState.questStage === 'fries_collected') {
    gameState.inventory.delete(quest.itemId);
    gameState.questStage = 'completed';
    saveQuestState();
    addFeed({ authorId: npc.id, text: quest.posts.complete });
    showDialog(npc.displayName, 'You brought the fries. This is not delivery. This is friendship infrastructure.');
    setStatus('Quest complete');
    updateQuestUI();
    updateQuestMarkers();
    return;
  }

  showDialog(npc.displayName, 'Those fries were historic. Your social capital increased.');
}

function interactWithLocation(locationId) {
  const location = LOCATIONS.find((candidate) => candidate.id === locationId);
  if (!location) return;

  if (locationId === 'mcdonalds') {
    enterMcDonalds();
    return;
  }

  showDialog(location.displayName, 'Nothing to do here yet.');
}

function interactWithCashier() {
  const quest = gameState.activeQuestId && QUESTS[gameState.activeQuestId];
  if (!quest || gameState.questStage === 'not_started') {
    showDialog('Cashier', 'Welcome in. Fries are available, but you do not have an order to place yet.');
    return;
  }

  if (gameState.questStage === 'accepted') {
    gameState.questStage = 'fries_ordered';
    gameState.friesReadyAt = Date.now() + quest.waitMs;
    saveQuestState();
    addFeed({ authorName: "McDonald's", handle: '@mcdonalds', text: quest.posts.ordered });
    showDialog('Cashier', "Got it. One fries order. It will take about five minutes, so come back later.");
    setStatus('Order placed');
    updateQuestUI();
    updateQuestMarkers();
    return;
  }

  if (gameState.questStage === 'fries_ordered') {
    if (Date.now() < gameState.friesReadyAt) {
      showDialog('Cashier', 'Still working on those fries. Check back a little later.');
      return;
    }

    gameState.inventory.add(quest.itemId);
    gameState.questStage = 'fries_collected';
    saveQuestState();
    addFeed({ authorName: "McDonald's", handle: '@mcdonalds', text: quest.posts.pickedUp });
    showDialog('Cashier', 'Your fries are ready. Careful, the bag is hot.');
    setStatus('Fries picked up');
    updateQuestUI();
    updateQuestMarkers();
    return;
  }

  if (gameState.questStage === 'fries_collected') {
    showDialog('Cashier', 'You already picked up the fries. jessyfries is waiting.');
    return;
  }

  showDialog('Cashier', 'Thanks for stopping by.');
}

function acceptQuest(quest, npc) {
  gameState.activeQuestId = quest.id;
  gameState.questStage = 'accepted';
  gameState.friesReadyAt = 0;
  saveQuestState();
  addFeed({ authorId: npc.id, text: quest.posts.accepted });
  setStatus('Quest accepted');
  updateQuestUI();
  updateQuestMarkers();
}

function enterMcDonalds() {
  gameState.world = 'mcdonaldsInterior';
  outsideGroup.visible = false;
  interiorGroup.visible = true;
  scene.background = new THREE.Color(0x2d2621);
  pendingInteraction = null;
  isMoving = false;
  clickMarker.visible = false;
  hero.position.set(0, 0, 4.2);
  targetPosition.copy(hero.position);
  setStatus("Inside McDonald's");
}

function exitMcDonalds() {
  const location = locations.get('mcdonalds');
  gameState.world = 'outside';
  outsideGroup.visible = true;
  interiorGroup.visible = false;
  scene.background = new THREE.Color(0x8db6c7);
  pendingInteraction = null;
  isMoving = false;
  clickMarker.visible = false;
  if (location) {
    hero.position.set(location.position.x + 2.8, 0, location.position.z + 2.6);
  }
  targetPosition.copy(hero.position);
  setStatus('Back outside');
}

function seedFeed() {
  const jessy = NPCS.find((npc) => npc.id === 'jessy');
  const quest = QUESTS.fries_for_jessy;
  addFeed({ authorId: jessy.id, text: quest.posts.start });
  addFeed({
    authorName: WALE_MOCA.displayName,
    handle: WALE_MOCA.handle,
    avatar: WALE_MOCA.avatar,
    verifiedIcon: WALE_MOCA.verifiedIcon,
    text: 'Gm, we are cooked',
    image: '/assets/wale.moca/waleswoosh_gm.jpeg',
    imageAlt: 'Attached image from wale.moca',
    replies: 844,
    reposts: 31,
    likes: '1K',
    views: '19K',
    bookmarks: 8,
  });
}

function addFeed(post) {
  const npc = post.authorId && NPCS.find((candidate) => candidate.id === post.authorId);
  const fixedStats = npc?.id === 'jessy'
    ? { replies: 377, reposts: 80, likes: 762, views: '80K' }
    : {};
  const hasExplicitViews = Object.prototype.hasOwnProperty.call(post, 'views');
  gameState.feed.unshift({
    displayName: post.authorName || npc?.displayName || 'ct world',
    handle: post.handle || npc?.handle || '@ctworld',
    avatar: post.avatar || npc?.avatar || '',
    verifiedIcon: post.verifiedIcon || npc?.verifiedIcon || '',
    text: post.text,
    image: post.image || '',
    imageAlt: post.imageAlt || '',
    time: post.time || 'now',
    replies: post.replies ?? fixedStats.replies ?? Math.floor(2 + Math.random() * 9),
    reposts: post.reposts ?? fixedStats.reposts ?? Math.floor(1 + Math.random() * 16),
    likes: post.likes ?? fixedStats.likes ?? Math.floor(18 + Math.random() * 90),
    views: hasExplicitViews ? post.views : fixedStats.views ?? `${Math.floor(1 + Math.random() * 9)}K`,
    bookmarks: post.bookmarks ?? null,
  });
  gameState.feed = gameState.feed.slice(0, 8);
  renderFeed();
}

function renderFeed() {
  feedList.replaceChildren(
    ...gameState.feed.map((post) => {
      const item = document.createElement('article');
      item.className = 'feed-post';

      const avatar = document.createElement(post.avatar ? 'img' : 'div');
      avatar.className = 'feed-avatar';
      if (post.avatar) {
        avatar.src = post.avatar;
        avatar.alt = `${post.displayName} avatar`;
      }

      const body = document.createElement('div');
      body.className = 'feed-body';

      const meta = document.createElement('div');
      meta.className = 'feed-meta';

      const name = document.createElement('span');
      name.className = 'feed-name';
      name.textContent = post.displayName;

      const verifiedIcon = document.createElement('img');
      verifiedIcon.className = 'feed-verified';
      verifiedIcon.src = post.verifiedIcon;
      verifiedIcon.alt = 'Verified';
      verifiedIcon.hidden = !post.verifiedIcon;

      const handle = document.createElement('span');
      handle.className = 'feed-handle';
      handle.textContent = post.handle;

      const dot = document.createElement('span');
      dot.textContent = '·';

      const time = document.createElement('span');
      time.className = 'feed-time';
      time.textContent = post.time;

      const text = document.createElement('div');
      text.className = 'feed-text';
      text.textContent = post.text;

      const media = post.image ? document.createElement('img') : null;
      if (media) {
        media.className = 'feed-media';
        media.src = post.image;
        media.alt = post.imageAlt || '';
      }

      const actions = document.createElement('div');
      actions.className = 'feed-actions';
      [
        ['reply', post.replies],
        ['repost', post.reposts],
        ['like', post.likes],
        ['view', post.views],
        ['bookmark', post.bookmarks],
        ['share', null],
      ].forEach(([icon, value]) => {
        const action = document.createElement('div');
        action.className = 'feed-action';
        const symbol = document.createElement('span');
        symbol.className = 'feed-action-icon';
        symbol.append(createFeedActionIcon(icon));
        action.append(symbol);
        if (value !== null) {
          const count = document.createElement('span');
          count.className = 'feed-action-count';
          count.textContent = String(value);
          action.append(count);
        }
        actions.append(action);
      });

      meta.append(name, verifiedIcon, handle, dot, time);
      body.append(meta, text);
      if (media) body.append(media);
      body.append(actions);
      item.append(avatar, body);
      return item;
    })
  );
}

function createFeedActionIcon(icon) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const paths = {
    reply: '<path d="M21 12a8.5 8.5 0 0 1-8.5 8.5H7l-4 2v-5A8.5 8.5 0 1 1 21 12Z"/>',
    repost: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    like: '<path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/>',
    view: '<path d="M4 20V10"/><path d="M9.3 20V4"/><path d="M14.7 20v-8"/><path d="M20 20V7"/>',
    bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>',
    share: '<path d="M12 16V3"/><path d="M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  };
  svg.innerHTML = paths[icon] || '';
  return svg;
}

function updateQuestUI() {
  if (!questChip) return;

  if (!gameState.activeQuestId) {
    questChip.textContent = 'No active quest';
    return;
  }

  const quest = QUESTS[gameState.activeQuestId];
  const shop = locations.get(quest.shopId);
  const giver = npcs.get(quest.giverId);

  if (gameState.questStage === 'accepted') {
    questChip.textContent = `${quest.title}: order ${quest.itemName} at ${shop?.name || "McDonald's"}`;
    return;
  }

  if (gameState.questStage === 'fries_ordered') {
    questChip.textContent = `${quest.title}: return later for pickup`;
    return;
  }

  if (gameState.questStage === 'fries_collected') {
    questChip.textContent = `${quest.title}: return to ${giver?.name || 'jessyfries'}`;
    return;
  }

  questChip.textContent = `${quest.title}: complete`;
}

function updateQuestMarkers() {
  const jessy = npcs.get('jessy');
  if (!jessy?.userData.questMarker) return;

  const marker = jessy.userData.questMarker;
  if (!gameState.activeQuestId || gameState.questStage === 'not_started') {
    marker.visible = true;
    setQuestMarkerLabel(marker, '?');
    return;
  }

  if (gameState.questStage === 'fries_collected') {
    marker.visible = true;
    setQuestMarkerLabel(marker, '!');
    return;
  }

  marker.visible = false;
}

function setQuestMarkerLabel(sprite, text) {
  if (sprite.userData.markerText === text) return;

  const replacement = createQuestMarkerSprite(text);
  sprite.material.map = replacement.material.map;
  sprite.material.needsUpdate = true;
  sprite.scale.copy(replacement.scale);
  sprite.userData.baseScale = replacement.scale.clone();
  sprite.userData.markerText = text;
}

function showDialog(name, text, options = {}) {
  dialogName.textContent = name;
  dialogText.textContent = text;
  dialogClose.textContent = options.primaryLabel || 'OK';
  dialogPrimaryAction = options.onPrimary || null;
  dialogSecondaryAction = options.onSecondary || null;
  if (options.secondaryLabel) {
    dialogSecondary.hidden = false;
    dialogSecondary.textContent = options.secondaryLabel;
  } else {
    dialogSecondary.hidden = true;
    dialogSecondary.textContent = 'Not now';
  }
  dialogPanel.hidden = false;
}

function clearDialogActions() {
  dialogPrimaryAction = null;
  dialogSecondaryAction = null;
}

function tick() {
  const delta = Math.min(clock.getDelta(), 0.05);
  updateHero(delta);
  updateCamera(delta);
  updateInfiniteMap();
  updateMarker();
  updateQuestMarkerPulse();
  if (heroMixer) heroMixer.update(delta);
  npcMixers.forEach((mixer) => mixer.update(delta));
  renderer.render(scene, camera);
}

function updateHero(delta) {
  if (!hero || !isMoving) {
    setAnimation(false);
    return;
  }

  const toTarget = targetPosition.clone().sub(hero.position);
  toTarget.y = 0;
  const distance = toTarget.length();

  if (distance < 0.08) {
    hero.position.copy(targetPosition);
    heroVelocity.set(0, 0, 0);
    isMoving = false;
    if (pendingInteraction && flatDistance(hero.position, pendingInteraction.position) <= INTERACTION_DISTANCE) {
      const target = pendingInteraction;
      pendingInteraction = null;
      interact(target);
    } else {
      setStatus('Arrived');
    }
    setAnimation(false);
    return;
  }

  const step = Math.min(distance, HERO_SPEED * delta);
  heroVelocity.copy(toTarget.normalize()).multiplyScalar(step);
  hero.position.add(heroVelocity);
  hero.rotation.y = Math.atan2(heroVelocity.x, heroVelocity.z);
  setAnimation(true);
}

function setAnimation(shouldWalk) {
  const active = shouldWalk ? walkAction : idleAction;
  if (!active) {
    if (currentAction) {
      currentAction.fadeOut(0.18);
      currentAction = undefined;
    }
    return;
  }

  if (currentAction !== active) {
    if (currentAction) currentAction.fadeOut(0.18);
    active.reset().fadeIn(0.18).play();
    currentAction = active;
  }
}

function updateCamera(delta) {
  if (!hero) return;
  const desired = hero.position.clone().add(cameraOffset);
  camera.position.lerp(desired, 1 - Math.pow(0.001, delta));
  camera.lookAt(hero.position.x, 0, hero.position.z);
}

function updateInfiniteMap() {
  if (!hero || gameState.world !== 'outside') return;
  map.position.x = hero.position.x;
  map.position.z = hero.position.z;
  updateMapTextureOffset();
}

function updateMapTextureOffset() {
  const texture = map.material.map;
  if (!texture) return;

  texture.offset.x = wrapTextureOffset(
    map.position.x / MAP_TILE_WIDTH - MAP_VISIBLE_TILES / 2
  );
  texture.offset.y = wrapTextureOffset(
    -map.position.z / mapTileDepth - MAP_VISIBLE_TILES / 2
  );
}

function wrapTextureOffset(value) {
  return ((value % 1) + 1) % 1;
}

function updateMarker() {
  if (!clickMarker.visible) return;
  const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.08;
  clickMarker.scale.setScalar(pulse);
}

function updateQuestMarkerPulse() {
  const marker = npcs.get('jessy')?.userData.questMarker;
  if (!marker?.visible) return;

  const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.07;
  const baseScale = marker.userData.baseScale || marker.scale;
  marker.scale.set(baseScale.x * pulse, baseScale.y * pulse, baseScale.z);
}

function resize() {
  const aspect = window.innerWidth / window.innerHeight;
  const frustumHeight = 20;
  camera.left = (-frustumHeight * aspect) / 2;
  camera.right = (frustumHeight * aspect) / 2;
  camera.top = frustumHeight / 2;
  camera.bottom = -frustumHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
