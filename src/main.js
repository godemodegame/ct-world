import './styles.css';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LOCATIONS, NPCS, QUEST_ITEMS, QUESTS, WALE_MOCA } from './data/gameData.js';

const MAP_TILE_WIDTH = 48;
const MAP_VISIBLE_TILES = 12;
const HERO_SPEED = 9;
const INTERACTION_DISTANCE = 2.6;
const HERO_COLLISION_RADIUS = 0.55;
const HERO_ASSETS = ['/assets/hero.fbx', '/assets/hero.glb', '/assets/hero.gltf'];
const HERO_TARGET_HEIGHT = 2.4;
const NPC_TARGET_HEIGHT = 2.1;
const MODEL_FACE_DOWN_OFFSET = Math.PI / 2;
const MAP_ASSET = '/assets/map.png';
const MCDONALDS_BUILDING_ASSET = '/assets/mcdonalds/mcdonalds_building.fbx';
const MCDONALDS_FLOOR_ASSET = '/assets/mcdonalds/floor.png';
const MCDONALDS_WALL_ASSET = '/assets/mcdonalds/wall.png';
const MCDONALDS_CASHIER_ASSET = '/assets/mcdonalds/cashier.fbx';
const MCDONALDS_CASHIER_TEXTURE = '/assets/mcdonalds/cashier_texture.jpg';
const MCDONALDS_BUILDING_TARGET_HEIGHT = 3.4;
const CASHIER_COUNTER_TARGET_HEIGHT = 2.3;
const CASHIER_DIALOG_NAME = 'waleswoosh';
const WALK_COLLIDERS = {
  mcdonaldsInterior: [
    { minX: -4.6, maxX: 4.6, minZ: -4.15, maxZ: -2.35 },
    { minX: -7.4, maxX: -4.55, minZ: -5.45, maxZ: -4.05 },
    { minX: -8.2, maxX: -5.25, minZ: -0.9, maxZ: 1.45 },
    { minX: -8.2, maxX: -5.25, minZ: 3.05, maxZ: 5.4 },
    { minX: 5.25, maxX: 8.2, minZ: -0.35, maxZ: 2 },
    { minX: 5.25, maxX: 8.2, minZ: 3.4, maxZ: 5.75 },
  ],
  luminaraCafeInterior: [
    { minX: -3.8, maxX: 3.8, minZ: -3.8, maxZ: -2.35 },
    { minX: -4.9, maxX: -3.4, minZ: -1.3, maxZ: 1.35 },
    { minX: 3.4, maxX: 4.9, minZ: -1.3, maxZ: 1.35 },
  ],
};
const QUEST_STORAGE_KEY = 'ct-world.questState';
const LEGACY_QUEST_STORAGE_KEYS = ['ct-world.friesForJessy', 'kris-rpg.friesForJessy'];

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
const beggingActors = [];
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

const cafeInteriorGroup = new THREE.Group();
cafeInteriorGroup.name = 'Luminara Coffee Interior';
cafeInteriorGroup.visible = false;
scene.add(cafeInteriorGroup);

const gameState = {
  activeQuestId: null,
  questStage: 'not_started',
  inventory: new Set(),
  completedQuestIds: new Set(),
  feed: [],
  world: 'outside',
  readyAt: 0,
};
loadQuestState();

const map = createMap();
outsideGroup.add(map);

const locations = createLocations();
const npcs = createNPCs();
const questItems = createQuestItems();
const interior = createMcDonaldsInterior();
const cafeInterior = createLuminaraCafeInterior();

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
  if (!isCollapsed) scrollFeedToBottom();
}

function loadQuestState() {
  const saved = JSON.parse(
    localStorage.getItem(QUEST_STORAGE_KEY)
      || LEGACY_QUEST_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean)
      || '{}'
  );
  if (saved.activeQuestId) gameState.activeQuestId = saved.activeQuestId;
  if (saved.questStage) gameState.questStage = normalizeQuestStage(saved.questStage);
  if (Array.isArray(saved.completedQuestIds)) {
    gameState.completedQuestIds = new Set(saved.completedQuestIds);
  }
  if (Number.isFinite(saved.readyAt)) gameState.readyAt = saved.readyAt;
  if (Number.isFinite(saved.friesReadyAt)) gameState.readyAt = saved.friesReadyAt;
  if (gameState.activeQuestId && gameState.questStage === 'completed') {
    gameState.completedQuestIds.add(gameState.activeQuestId);
    gameState.activeQuestId = null;
    gameState.questStage = 'not_started';
  }
}

function saveQuestState() {
  localStorage.setItem(QUEST_STORAGE_KEY, JSON.stringify({
    activeQuestId: gameState.activeQuestId,
    questStage: gameState.questStage,
    readyAt: gameState.readyAt,
    completedQuestIds: [...gameState.completedQuestIds],
  }));
}

function normalizeQuestStage(stage) {
  const legacyStages = {
    fries_ordered: 'ordered',
    fries_collected: 'collected',
  };
  return legacyStages[stage] || stage;
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
    const world = npc.world || 'outside';
    const group = new THREE.Group();
    group.name = npc.displayName;
    group.position.set(npc.position.x, 0, npc.position.z);
    group.userData.interactive = { kind: 'npc', id: npc.id, world };

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
    questMarker.position.set(0, getNPCQuestMarkerY(npc), 0);
    questMarker.userData.baseScale = questMarker.scale.clone();
    questMarker.visible = Boolean(npc.questId);
    group.userData.questMarker = questMarker;
    group.add(questMarker);

    const label = createLabelSprite(npc.handle, {
      background: 'rgba(15, 23, 32, 0.82)',
      color: '#ffffff',
    });
    label.position.set(0, getNPCLabelY(npc), 0);
    group.add(label);

    if (npc.behavior === 'begging') {
      const beggingSetup = createBeggingSetup();
      group.userData.beggingSetup = beggingSetup;
      group.add(beggingSetup);

      const speechBubble = createSpeechBubbleSprite('Spare a little cash for me?');
      speechBubble.position.set(0.3, 3.22, 0.18);
      group.add(speechBubble);
    }

    if (npc.model) {
      loadNPCModel(npc, group, fallbackVisual);
    }

    getWorldGroup(world).add(group);
    interactiveRoots.push(group);
    npcMap.set(npc.id, group);
  });

  return npcMap;
}

function getWorldGroup(world) {
  if (world === 'mcdonaldsInterior') return interiorGroup;
  if (world === 'luminaraCafeInterior') return cafeInteriorGroup;
  return outsideGroup;
}

function getNPCQuestMarkerY(npc) {
  if (npc.behavior === 'begging') return 3.05;
  if (npc.behavior === 'sitting') return 2.88;
  return 3.72;
}

function getNPCLabelY(npc) {
  if (Number.isFinite(npc.labelY)) return npc.labelY;
  if (npc.behavior === 'begging') return 2.05;
  if (npc.behavior === 'sitting') return 1.92;
  return 2.56;
}

function createQuestItems() {
  const itemMap = new Map();

  QUEST_ITEMS.forEach((item) => {
    const group = new THREE.Group();
    group.name = item.displayName;
    group.position.set(item.position.x, 0, item.position.z);
    group.userData.interactive = { kind: 'questItem', id: item.id, world: 'outside' };

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 28),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.16 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.035;
    group.add(shadow);

    const visual = createCoffeeBeansSack();
    group.add(visual);

    const questMarker = createQuestMarkerSprite('!');
    questMarker.position.set(0, 1.9, 0);
    questMarker.userData.baseScale = questMarker.scale.clone();
    group.userData.questMarker = questMarker;
    group.add(questMarker);

    const label = createLabelSprite(item.displayName, {
      background: 'rgba(63, 44, 34, 0.88)',
      color: '#f7ead2',
      fontSize: 34,
      paddingX: 18,
      paddingY: 10,
    });
    label.position.set(0, 1.34, 0);
    group.add(label);

    group.visible = false;
    outsideGroup.add(group);
    interactiveRoots.push(group);
    itemMap.set(item.id, group);
  });

  return itemMap;
}

function createCoffeeBeansSack() {
  const group = new THREE.Group();
  group.name = 'Coffee Beans Sack';

  const sackMaterial = new THREE.MeshStandardMaterial({ color: 0xb88958, roughness: 0.88 });
  const twineMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3824, roughness: 0.8 });
  const beanMaterial = new THREE.MeshStandardMaterial({ color: 0x3a1f16, roughness: 0.62 });

  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.48, 24, 16), sackMaterial);
  sack.scale.set(0.9, 0.72, 0.82);
  sack.position.y = 0.48;
  sack.castShadow = true;
  sack.receiveShadow = true;
  group.add(sack);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.32, 18), sackMaterial);
  neck.position.y = 0.98;
  neck.castShadow = true;
  group.add(neck);

  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 28), twineMaterial);
  tie.position.y = 0.88;
  tie.rotation.x = Math.PI / 2;
  tie.castShadow = true;
  group.add(tie);

  [
    { x: -0.19, z: 0.45, r: 0.2 },
    { x: 0.02, z: 0.5, r: -0.1 },
    { x: 0.2, z: 0.42, r: 0.34 },
  ].forEach(({ x, z, r }) => {
    const bean = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 8), beanMaterial);
    bean.scale.set(1, 0.48, 0.68);
    bean.position.set(x, 0.18, z);
    bean.rotation.set(0.2, r, -0.32);
    bean.castShadow = true;
    group.add(bean);
  });

  return group;
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

function createBeggingSetup() {
  const group = new THREE.Group();
  group.name = 'Begging Setup';

  const cardboardMaterial = new THREE.MeshStandardMaterial({ color: 0x9b6b3f, roughness: 0.92 });
  const cupMaterial = new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.72 });
  const coinMaterial = new THREE.MeshStandardMaterial({ color: 0xe0b64b, roughness: 0.38, metalness: 0.42 });

  const mat = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.035, 1.25), cardboardMaterial);
  mat.position.set(0, 0.08, 0.04);
  mat.rotation.y = -0.08;
  mat.castShadow = true;
  mat.receiveShadow = true;
  group.add(mat);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.22, 0.58),
    createBeggingSignMaterial()
  );
  sign.name = 'Begging Sign';
  sign.position.set(0.1, 0.48, 0.84);
  sign.rotation.x = -0.2;
  sign.castShadow = true;
  group.add(sign);

  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.34, 24), cupMaterial);
  cup.name = 'Begging Cup';
  cup.position.set(0.45, 0.22, 1.02);
  cup.castShadow = true;
  cup.receiveShadow = true;
  group.add(cup);

  const cupLip = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), cupMaterial);
  cupLip.name = 'Begging Cup Lip';
  cupLip.position.set(0.45, 0.4, 1.02);
  cupLip.rotation.x = Math.PI / 2;
  cupLip.castShadow = true;
  group.add(cupLip);

  [
    { x: 0.32, z: 0.82, r: 0.14 },
    { x: 0.57, z: 0.88, r: -0.22 },
    { x: 0.43, z: 1.2, r: 0.33 },
  ].forEach(({ x, z, r }) => {
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.018, 18), coinMaterial);
    coin.position.set(x, 0.12, z);
    coin.rotation.set(Math.PI / 2, 0, r);
    coin.castShadow = true;
    group.add(coin);
  });

  return group;
}

function createSpeechBubbleSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 236;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  roundRect(ctx, 28, 18, 584, 146, 28);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(474, 156);
  ctx.lineTo(424, 208);
  ctx.lineTo(524, 164);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(31, 41, 55, 0.22)';
  ctx.lineWidth = 7;
  roundRect(ctx, 28, 18, 584, 146, 28);
  ctx.stroke();

  ctx.fillStyle = '#111827';
  ctx.font = '800 38px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  wrapCanvasText(ctx, text, canvas.width / 2, 78, 500, 42);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.2, 1.18, 1);
  return sprite;
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  const lines = [];
  let line = '';

  words.forEach((word) => {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  });
  if (line) lines.push(line);

  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((textLine, index) => {
    ctx.fillText(textLine, x, startY + index * lineHeight);
  });
}

function createBeggingSignMaterial() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#9b6b3f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#604124';
  ctx.lineWidth = 14;
  ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
  ctx.fillStyle = '#2a1b10';
  ctx.font = '900 56px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SPARE $?', canvas.width / 2, 95);
  ctx.font = '760 34px Inter, Arial, sans-serif';
  ctx.fillText('need fries money', canvas.width / 2, 160);
  ctx.fillStyle = 'rgba(42, 27, 16, 0.22)';
  ctx.fillRect(70, 205, 372, 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
  return material;
}

function loadNPCModel(npc, group, fallbackVisual) {
  const asset = npc.model;
  const loader = createHeroLoader(asset);
  const texture = npc.texture ? loadCharacterTexture(npc.texture) : null;
  loader.load(
    asset,
    (loaded) => {
      const model = loaded.scene || loaded;
      prepareModel(model, getNPCTargetHeight(npc));
      if (texture) applyTextureToModel(model, texture);
      model.rotation.y = getNPCModelRotationY(npc);
      if (npc.behavior === 'begging') {
        playNPCIdleAnimation(model, loaded.animations);
        registerBeggingActor(group, model, { animateBones: false });
      } else if (npc.behavior === 'sitting') {
        const hasSittingAnimation = playNPCAnimation(model, loaded.animations, ['sit', 'sitting', 'seated', 'chair', 'mixamo'], {
          useFirstFallback: true,
        });
        if (!hasSittingAnimation) applySittingPose(model);
      } else {
        playNPCIdleAnimation(model, loaded.animations);
      }
      group.remove(fallbackVisual);
      group.add(model);
    },
    undefined,
    () => {
      setStatus(`Could not load ${asset.split('/').pop()}`);
    }
  );
}

function getNPCTargetHeight(npc) {
  if (Number.isFinite(npc.targetHeight)) return npc.targetHeight;
  return ['begging', 'sitting'].includes(npc.behavior) ? 1.72 : NPC_TARGET_HEIGHT;
}

function getNPCModelRotationY(npc) {
  if (Number.isFinite(npc.modelRotationY)) return npc.modelRotationY;
  if (npc.id === 'luminara') return MODEL_FACE_DOWN_OFFSET - Math.PI / 2;
  if (npc.behavior === 'begging') return MODEL_FACE_DOWN_OFFSET - Math.PI / 2;

  return Math.PI + MODEL_FACE_DOWN_OFFSET;
}

function applyBeggingPose(model) {
  rotateBone(model, 'Hips', { x: -0.18 });
  rotateBone(model, 'Spine', { x: 0.18 });
  rotateBone(model, 'Spine1', { x: 0.12 });
  rotateBone(model, 'LeftUpLeg', { x: -1.34, z: 0.16 });
  rotateBone(model, 'RightUpLeg', { x: -1.34, z: -0.16 });
  rotateBone(model, 'LeftLeg', { x: 1.18 });
  rotateBone(model, 'RightLeg', { x: 1.18 });
  rotateBone(model, 'LeftFoot', { x: 0.34 });
  rotateBone(model, 'RightFoot', { x: 0.34 });
  rotateBone(model, 'LeftArm', { z: -0.48 });
  rotateBone(model, 'RightArm', { z: 0.48 });
  rotateBone(model, 'LeftForeArm', { z: -0.52 });
  rotateBone(model, 'RightForeArm', { z: 0.52 });
  model.position.y -= 0.06;
  model.updateMatrixWorld(true);
}

function applySittingPose(model) {
  rotateBone(model, 'Hips', { x: -0.12 });
  rotateBone(model, 'Spine', { x: 0.18 });
  rotateBone(model, 'Spine1', { x: 0.1 });
  rotateBone(model, 'LeftUpLeg', { x: -1.32, z: 0.08 });
  rotateBone(model, 'RightUpLeg', { x: -1.32, z: -0.08 });
  rotateBone(model, 'LeftLeg', { x: 1.24 });
  rotateBone(model, 'RightLeg', { x: 1.24 });
  rotateBone(model, 'LeftFoot', { x: 0.28 });
  rotateBone(model, 'RightFoot', { x: 0.28 });
  rotateBone(model, 'LeftArm', { z: -0.3 });
  rotateBone(model, 'RightArm', { z: 0.3 });
  rotateBone(model, 'LeftForeArm', { z: -0.26 });
  rotateBone(model, 'RightForeArm', { z: 0.26 });
  rotateBone(model, 'Head', { x: -0.04 });
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  if (Number.isFinite(box.min.y)) {
    model.position.y -= box.min.y;
  }
  model.position.y -= 0.24;
  model.updateMatrixWorld(true);
}

function registerBeggingActor(group, model, options = {}) {
  const boneNames = [
    'Hips',
    'Spine',
    'Spine1',
    'LeftArm',
    'RightArm',
    'LeftForeArm',
    'RightForeArm',
    'LeftHand',
    'RightHand',
    'Head',
  ];
  const bones = Object.fromEntries(
    boneNames
      .map((name) => [name, findBone(model, name)])
      .filter(([, bone]) => bone)
  );
  const baseRotations = new Map(
    Object.values(bones).map((bone) => [bone, bone.rotation.clone()])
  );

  group.rotation.y = 0;
  const setup = group.userData.beggingSetup;
  const sign = setup?.getObjectByName('Begging Sign');
  const cup = setup?.getObjectByName('Begging Cup');
  const cupLip = setup?.getObjectByName('Begging Cup Lip');
  beggingActors.push({
    group,
    model,
    bones,
    sign,
    cup,
    cupLip,
    baseModelY: model.position.y,
    baseSignRotationZ: sign?.rotation.z || 0,
    baseCupY: cup?.position.y || 0,
    baseCupLipY: cupLip?.position.y || 0,
    baseRotations,
    animateBones: options.animateBones ?? true,
    startedAt: performance.now() * 0.001,
  });
}

function updateBeggingActors() {
  const time = performance.now() * 0.001;
  beggingActors.forEach((actor) => {
    const elapsed = time - actor.startedAt;
    const breathe = Math.sin(elapsed * 2.2);
    const plead = Math.sin(elapsed * 3.4);
    const smallWave = Math.sin(elapsed * 5.1);

    if (actor.animateBones) {
      actor.model.position.y = actor.baseModelY + breathe * 0.018;
      setBeggingBoneOffset(actor, 'Hips', { x: breathe * 0.025 });
      setBeggingBoneOffset(actor, 'Spine', { x: breathe * 0.055 });
      setBeggingBoneOffset(actor, 'Spine1', { x: breathe * 0.04 });
      setBeggingBoneOffset(actor, 'Head', { x: -0.04 + smallWave * 0.035, y: plead * 0.035 });
      setBeggingBoneOffset(actor, 'LeftArm', { z: -0.08 + plead * 0.08 });
      setBeggingBoneOffset(actor, 'RightArm', { z: 0.08 - plead * 0.08 });
      setBeggingBoneOffset(actor, 'LeftForeArm', { z: -0.2 + plead * 0.16 });
      setBeggingBoneOffset(actor, 'RightForeArm', { z: 0.2 - plead * 0.16 });
      setBeggingBoneOffset(actor, 'LeftHand', { z: smallWave * 0.08 });
      setBeggingBoneOffset(actor, 'RightHand', { z: -smallWave * 0.08 });
    }
    if (actor.sign) actor.sign.rotation.z = actor.baseSignRotationZ + plead * 0.045;
    if (actor.cup) actor.cup.position.y = actor.baseCupY + Math.max(0, smallWave) * 0.018;
    if (actor.cupLip) actor.cupLip.position.y = actor.baseCupLipY + Math.max(0, smallWave) * 0.018;
  });
}

function setBeggingBoneOffset(actor, name, offset) {
  const bone = actor.bones[name];
  const base = actor.baseRotations.get(bone);
  if (!bone || !base) return;

  bone.rotation.set(
    base.x + (offset.x || 0),
    base.y + (offset.y || 0),
    base.z + (offset.z || 0)
  );
}

function rotateBone(model, name, rotation) {
  const bone = findBone(model, name);
  if (!bone) return;

  bone.rotation.x += rotation.x || 0;
  bone.rotation.y += rotation.y || 0;
  bone.rotation.z += rotation.z || 0;
}

function findBone(model, name) {
  let match = null;
  model.traverse((child) => {
    if (match || !child.isBone) return;
    if (child.name === name || child.name.endsWith(`:${name}`)) match = child;
  });
  return match;
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

    const fallbackBuilding = createFallbackLocationBuilding(location);
    group.add(fallbackBuilding);
    if (location.id === 'mcdonalds') {
      loadMcDonaldsBuildingModel(group, fallbackBuilding);
    } else if (location.kind === 'cafe') {
      group.remove(fallbackBuilding);
      group.add(createCafeLocationBuilding(location));
    }

    outsideGroup.add(group);
    interactiveRoots.push(group);
    locationMap.set(location.id, group);
  });

  return locationMap;
}

function createFallbackLocationBuilding(location) {
  const group = new THREE.Group();
  group.name = `${location.displayName} Fallback Building`;

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

  return group;
}

function createCafeLocationBuilding(location) {
  const group = new THREE.Group();
  group.name = `${location.displayName} Building`;

  const wallMaterial = new THREE.MeshStandardMaterial({ color: location.color, roughness: 0.74 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x3f2c22, roughness: 0.7 });
  const creamMaterial = new THREE.MeshStandardMaterial({ color: 0xf7ead2, roughness: 0.7 });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x7fc6d8,
    roughness: 0.22,
    metalness: 0.04,
    transparent: true,
    opacity: 0.78,
  });
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x6f4630, roughness: 0.78 });
  const plantMaterial = new THREE.MeshStandardMaterial({ color: 0x37764a, roughness: 0.82 });
  const beanMaterial = new THREE.MeshStandardMaterial({ color: 0x4a2618, roughness: 0.66 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.46, 2.45), wallMaterial);
  base.position.y = 0.73;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.72, 0.36, 2.88), roofMaterial);
  roof.position.y = 1.64;
  roof.castShadow = true;
  group.add(roof);

  const awning = createCafeAwning(location.accentColor, 0xf7ead2);
  awning.position.set(0, 1.38, 1.34);
  group.add(awning);

  const sign = createCafeSign(location.displayName);
  sign.position.set(0, 2.08, 1.47);
  group.add(sign);

  const leftWindow = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.58, 0.08), glassMaterial);
  leftWindow.position.set(-0.78, 0.94, 1.25);
  leftWindow.castShadow = true;
  group.add(leftWindow);

  const rightWindow = leftWindow.clone();
  rightWindow.position.x = 0.78;
  group.add(rightWindow);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.94, 0.09), woodMaterial);
  door.position.set(0, 0.52, 1.3);
  door.castShadow = true;
  group.add(door);

  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), creamMaterial);
  handle.position.set(0.17, 0.55, 1.36);
  group.add(handle);

  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.34), woodMaterial);
  bench.position.set(-1.05, 0.24, -1.58);
  bench.castShadow = true;
  group.add(bench);

  [-1.38, -0.72].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.14), woodMaterial);
    leg.position.set(x, 0.02, -1.58);
    leg.castShadow = true;
    group.add(leg);
  });

  [
    { x: -1.85, z: 1.08 },
    { x: 1.85, z: 1.08 },
  ].forEach(({ x, z }) => {
    const planter = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 0.34, 18), woodMaterial);
    planter.position.set(x, 0.18, z);
    planter.castShadow = true;
    group.add(planter);

    const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 10), plantMaterial);
    leaves.position.set(x, 0.52, z);
    leaves.castShadow = true;
    group.add(leaves);
  });

  const cup = createCoffeeCup(creamMaterial, beanMaterial);
  cup.position.set(1.12, 1.98, -0.5);
  cup.rotation.y = -0.42;
  group.add(cup);

  return group;
}

function createCafeAwning(primaryColor, secondaryColor) {
  const group = new THREE.Group();
  const stripeWidth = 0.42;
  for (let index = 0; index < 7; index += 1) {
    const material = new THREE.MeshStandardMaterial({
      color: index % 2 === 0 ? primaryColor : secondaryColor,
      roughness: 0.54,
    });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(stripeWidth, 0.28, 0.36), material);
    stripe.position.set((index - 3) * stripeWidth, 0, 0);
    stripe.castShadow = true;
    group.add(stripe);
  }
  return group;
}

function createCafeSign(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3f2c22';
  roundRect(ctx, 0, 0, canvas.width, canvas.height, 28);
  ctx.fill();
  ctx.fillStyle = '#f2c66d';
  ctx.font = '900 54px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, 72);
  ctx.fillStyle = '#f7ead2';
  ctx.font = '760 28px Inter, Arial, sans-serif';
  ctx.fillText('family cafe', canvas.width / 2, 124);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  return new THREE.Mesh(new THREE.PlaneGeometry(2.45, 0.7), material);
}

function createCoffeeCup(cupMaterial, coffeeMaterial) {
  const group = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.44, 24), cupMaterial);
  cup.position.y = 0.22;
  cup.castShadow = true;
  group.add(cup);

  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), coffeeMaterial);
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.45;
  group.add(coffee);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 22, Math.PI * 1.35), cupMaterial);
  handle.position.set(0.22, 0.26, 0);
  handle.rotation.z = Math.PI / 2;
  handle.castShadow = true;
  group.add(handle);

  return group;
}

function loadMcDonaldsBuildingModel(group, fallbackBuilding) {
  const loader = createHeroLoader(MCDONALDS_BUILDING_ASSET);

  loader.load(
    MCDONALDS_BUILDING_ASSET,
    (loaded) => {
      const model = loaded.scene || loaded;
      model.rotation.x = -Math.PI / 2;
      prepareModel(model, MCDONALDS_BUILDING_TARGET_HEIGHT);
      group.remove(fallbackBuilding);
      group.add(model);
    },
    undefined,
    () => {
      setStatus(`Could not load ${MCDONALDS_BUILDING_ASSET.split('/').pop()}`);
    }
  );
}

function createMcDonaldsInterior() {
  const floorMaterial = createRepeatingTextureMaterial(MCDONALDS_FLOOR_ASSET, {
    color: 0xeadfc9,
    repeat: [5, 4],
    roughness: 0.86,
  });
  const wallMaterial = createRepeatingTextureMaterial(MCDONALDS_WALL_ASSET, {
    color: 0xb82018,
    repeat: [6, 1],
    roughness: 0.72,
  });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 14, 1, 1),
    floorMaterial
  );
  floor.name = "McDonald's Interior Floor";
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  interiorGroup.add(floor);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(18, 3, 0.32),
    wallMaterial
  );
  backWall.position.set(0, 1.5, -6.8);
  backWall.receiveShadow = true;
  interiorGroup.add(backWall);

  const leftWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 3, 14),
    wallMaterial
  );
  leftWall.position.set(-9, 1.5, 0);
  leftWall.receiveShadow = true;
  interiorGroup.add(leftWall);

  const rightWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 3, 14),
    wallMaterial
  );
  rightWall.position.set(9, 1.5, 0);
  rightWall.receiveShadow = true;
  interiorGroup.add(rightWall);

  const brandedInterior = createMcDonaldsInteriorDecor();
  interiorGroup.add(brandedInterior);

  const counter = createCashierCounter();
  counter.position.set(0, 0, -3.2);
  counter.userData.interactive = { kind: 'cashier', id: 'mcdonalds_cashier_counter', world: 'mcdonaldsInterior' };
  interiorGroup.add(counter);
  interactiveRoots.push(counter);

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

function createLuminaraCafeInterior() {
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x7c5a3c, roughness: 0.88 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x9f6a45, roughness: 0.76 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x3f2c22, roughness: 0.7 });
  const creamMaterial = new THREE.MeshStandardMaterial({ color: 0xf7ead2, roughness: 0.72 });
  const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c66d, roughness: 0.52 });
  const plantMaterial = new THREE.MeshStandardMaterial({ color: 0x37764a, roughness: 0.82 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d1c4, roughness: 0.42, metalness: 0.18 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 10, 1, 1), floorMaterial);
  floor.name = 'Luminara Coffee Interior Floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  cafeInteriorGroup.add(floor);

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 0.32), wallMaterial);
  backWall.position.set(0, 1.5, -4.85);
  backWall.receiveShadow = true;
  cafeInteriorGroup.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3, 10), wallMaterial);
  leftWall.position.set(-6, 1.5, 0);
  leftWall.receiveShadow = true;
  cafeInteriorGroup.add(leftWall);

  const rightWall = leftWall.clone();
  rightWall.position.x = 6;
  cafeInteriorGroup.add(rightWall);

  cafeInteriorGroup.add(createWallStripe(0, 2.52, -4.65, 11.5, 0.16, 0.12, goldMaterial));
  cafeInteriorGroup.add(createWallStripe(-5.82, 2.34, 0, 0.1, 0.14, 9.4, goldMaterial));
  cafeInteriorGroup.add(createWallStripe(5.82, 2.34, 0, 0.1, 0.14, 9.4, goldMaterial));

  const menu = createMenuBoard('COFFEE', ['Latte', 'Mocha', 'Cold Brew'], '#9f6a45');
  menu.position.set(0, 2.22, -4.62);
  cafeInteriorGroup.add(menu);

  const counter = createCafeInteriorCounter({ trimMaterial, creamMaterial, goldMaterial, metalMaterial });
  counter.position.set(0, 0, -2.95);
  cafeInteriorGroup.add(counter);

  [
    { x: -3.65, z: -0.8, rotation: 0.18 },
    { x: 3.65, z: -0.7, rotation: -0.16 },
    { x: -2.6, z: 2.05, rotation: -0.1 },
    { x: 2.6, z: 2.05, rotation: 0.1 },
  ].forEach((placement, index) => {
    const tableSet = createDiningSet({
      creamMaterial,
      yellowMaterial: goldMaterial,
      redMaterial: index % 2 ? trimMaterial : wallMaterial,
      darkMaterial: trimMaterial,
      metalMaterial,
    });
    tableSet.position.set(placement.x, 0, placement.z);
    tableSet.rotation.y = placement.rotation;
    cafeInteriorGroup.add(tableSet);
  });

  [
    { x: -5.55, z: 2.9 },
    { x: 5.55, z: 2.7 },
  ].forEach(({ x, z }) => {
    const planter = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.42, 18), trimMaterial);
    planter.position.set(x, 0.21, z);
    planter.castShadow = true;
    cafeInteriorGroup.add(planter);

    const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12), plantMaterial);
    leaves.position.set(x, 0.64, z);
    leaves.castShadow = true;
    cafeInteriorGroup.add(leaves);
  });

  const exit = createExitMarker();
  exit.position.set(0, 0, 3.8);
  exit.userData.interactive = { kind: 'exit', id: 'luminara_cafe_exit', world: 'luminaraCafeInterior' };
  cafeInteriorGroup.add(exit);
  interactiveRoots.push(exit);

  return { floor, exit };
}

function createCafeInteriorCounter(materials) {
  const group = new THREE.Group();
  group.name = 'Luminara Coffee Counter';

  const counter = new THREE.Mesh(new THREE.BoxGeometry(7.6, 1, 0.92), materials.trimMaterial);
  counter.position.y = 0.5;
  counter.castShadow = true;
  counter.receiveShadow = true;
  group.add(counter);

  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(7.9, 0.16, 1.08), materials.creamMaterial);
  counterTop.position.y = 1.06;
  counterTop.castShadow = true;
  group.add(counterTop);

  const frontPanel = createCafeSign('Luminara Coffee');
  frontPanel.position.set(0, 0.68, 0.48);
  frontPanel.scale.set(0.84, 0.84, 1);
  group.add(frontPanel);

  const espressoMachine = createEspressoMachine(materials.metalMaterial, materials.goldMaterial);
  espressoMachine.position.set(-2.35, 1.18, -0.08);
  group.add(espressoMachine);

  const cups = createStackedCups(materials.creamMaterial);
  cups.position.set(2.5, 1.16, 0.02);
  group.add(cups);

  return group;
}

function createEspressoMachine(metalMaterial, accentMaterial) {
  const group = new THREE.Group();
  group.name = 'Espresso Machine';

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.58, 0.48), metalMaterial);
  body.position.y = 0.29;
  body.castShadow = true;
  group.add(body);

  const top = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.14, 0.38), accentMaterial);
  top.position.y = 0.67;
  top.castShadow = true;
  group.add(top);

  [-0.28, 0.28].forEach((x) => {
    const portafilter = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 12), accentMaterial);
    portafilter.position.set(x, 0.12, 0.34);
    portafilter.rotation.x = Math.PI / 2;
    portafilter.castShadow = true;
    group.add(portafilter);
  });

  return group;
}

function createStackedCups(cupMaterial) {
  const group = new THREE.Group();
  group.name = 'Stacked Coffee Cups';

  for (let index = 0; index < 3; index += 1) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.2, 20), cupMaterial);
    cup.position.y = 0.1 + index * 0.17;
    cup.castShadow = true;
    group.add(cup);
  }

  return group;
}

function createMcDonaldsInteriorDecor() {
  const group = new THREE.Group();
  group.name = "McDonald's Interior Decor";

  const redMaterial = new THREE.MeshStandardMaterial({ color: 0xd9281e, roughness: 0.52 });
  const yellowMaterial = new THREE.MeshStandardMaterial({ color: 0xffc72c, roughness: 0.48 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1613, roughness: 0.68 });
  const creamMaterial = new THREE.MeshStandardMaterial({ color: 0xf4e8d5, roughness: 0.7 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d7d1, roughness: 0.42, metalness: 0.18 });

  group.add(createWallStripe(0, 2.55, -6.6, 17.4, 0.22, 0.12, yellowMaterial));
  group.add(createWallStripe(-8.82, 2.38, 0, 0.12, 0.18, 13.2, yellowMaterial));
  group.add(createWallStripe(8.82, 2.38, 0, 0.12, 0.18, 13.2, yellowMaterial));

  const menuBoard = createMenuBoards();
  menuBoard.position.set(0, 2.24, -6.36);
  group.add(menuBoard);

  [-6.45, -5.25].forEach((x, index) => {
    const kiosk = createOrderKiosk(index + 1);
    kiosk.position.set(x, 0, -4.85);
    kiosk.rotation.y = -0.14;
    group.add(kiosk);
  });

  [
    { x: -6.75, z: 0.2, rotation: 0.1 },
    { x: -6.75, z: 4.2, rotation: -0.08 },
    { x: 6.75, z: 0.85, rotation: -0.12 },
    { x: 6.75, z: 4.45, rotation: 0.1 },
  ].forEach((placement) => {
    const tableSet = createDiningSet({
      redMaterial,
      yellowMaterial,
      darkMaterial,
      creamMaterial,
      metalMaterial,
      scale: 1.22,
    });
    tableSet.position.set(placement.x, 0, placement.z);
    tableSet.rotation.y = placement.rotation;
    group.add(tableSet);
  });

  [
    { x: -8.72, z: 1.85, width: 0.2, depth: 2.75 },
    { x: 8.72, z: 2.45, width: 0.2, depth: 3.05 },
  ].forEach((placement) => {
    const booth = createBooth(placement.width, placement.depth, redMaterial, darkMaterial);
    booth.position.set(placement.x, 0, placement.z);
    group.add(booth);
  });

  [
    { x: -2.2, z: -0.9 },
    { x: 0, z: -0.55 },
    { x: 2.2, z: -0.9 },
    { x: -6.45, z: 2.25 },
    { x: 6.55, z: 2.75 },
  ].forEach(({ x, z }) => {
    const mat = createFloorMat();
    mat.position.set(x, 0.055, z);
    group.add(mat);
  });

  return group;
}

function createWallStripe(x, y, z, width, height, depth, material) {
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  stripe.position.set(x, y, z);
  stripe.castShadow = true;
  return stripe;
}

function createMenuBoards() {
  const group = new THREE.Group();
  group.name = 'Menu Boards';

  [
    { x: -3.05, title: 'BURGERS', rows: ['Big Mac', 'McChicken', 'Cheeseburger'], accent: '#d9281e' },
    { x: 0, title: 'FRIES', rows: ['Small', 'Medium', 'Large'], accent: '#ffc72c' },
    { x: 3.05, title: 'DRINKS', rows: ['Cola', 'Sprite', 'Coffee'], accent: '#1d9bf0' },
  ].forEach((board) => {
    const mesh = createMenuBoard(board.title, board.rows, board.accent);
    mesh.position.set(board.x, 0, 0);
    group.add(mesh);
  });

  return group;
}

function createMenuBoard(title, rows, accent) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 288;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#17130f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, canvas.width, 48);
  ctx.fillStyle = '#fff6dc';
  ctx.font = '900 34px Inter, Arial, sans-serif';
  ctx.fillText(title, 24, 36);

  rows.forEach((row, index) => {
    const y = 92 + index * 56;
    ctx.fillStyle = '#fff6dc';
    ctx.font = '760 28px Inter, Arial, sans-serif';
    ctx.fillText(row, 28, y);
    ctx.fillStyle = '#ffc72c';
    ctx.fillText(`$${index + 2}.99`, 368, y);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(28, y + 18, 456, 2);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.65, 1.48), material);
  mesh.name = `${title} Menu Board`;
  return mesh;
}

function createOrderKiosk(index) {
  const group = new THREE.Group();
  group.name = `Self Order Kiosk ${index}`;
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x26211d, roughness: 0.58 });
  const screenMaterial = createScreenMaterial('ORDER', ['Big Mac', 'Fries', 'Drink'], '#ffc72c');
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xffc72c, roughness: 0.48 });

  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.1, 0.38), bodyMaterial);
  pedestal.position.y = 0.55;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.9, 0.08), screenMaterial);
  screen.position.set(0, 1.42, 0.15);
  screen.rotation.x = -0.08;
  screen.castShadow = true;
  group.add(screen);

  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.12, 0.42), accentMaterial);
  cap.position.set(0, 1.93, 0.1);
  cap.castShadow = true;
  group.add(cap);

  return group;
}

function createScreenMaterial(title, rows, accent) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8f1df';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, canvas.width, 56);
  ctx.fillStyle = '#211407';
  ctx.font = '900 31px Inter, Arial, sans-serif';
  ctx.fillText(title, 24, 38);
  rows.forEach((row, index) => {
    const y = 102 + index * 58;
    ctx.fillStyle = index === 1 ? '#d9281e' : '#27201a';
    roundRect(ctx, 28, y - 30, 200, 42, 9);
    ctx.fill();
    ctx.fillStyle = '#fff6dc';
    ctx.font = '760 23px Inter, Arial, sans-serif';
    ctx.fillText(row, 48, y);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture });
}

function createDiningSet(materials) {
  const group = new THREE.Group();
  group.name = 'Dining Set';
  const diningScale = materials.scale || 1;
  const tabletop = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.12, 32), materials.creamMaterial || materials.yellowMaterial);
  tabletop.position.y = 0.72;
  tabletop.castShadow = true;
  tabletop.receiveShadow = true;
  group.add(tabletop);

  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.72, 16), materials.metalMaterial);
  leg.position.y = 0.36;
  leg.castShadow = true;
  group.add(leg);

  [
    { x: 0, z: -0.95, rotation: 0 },
    { x: 0, z: 0.95, rotation: Math.PI },
    { x: -0.95, z: 0, rotation: Math.PI / 2 },
    { x: 0.95, z: 0, rotation: -Math.PI / 2 },
  ].forEach((placement, index) => {
    const chair = createChair(index % 2 ? materials.redMaterial : materials.darkMaterial, materials.metalMaterial);
    chair.position.set(placement.x, 0, placement.z);
    chair.rotation.y = placement.rotation;
    group.add(chair);
  });

  group.scale.setScalar(diningScale);
  return group;
}

function createChair(seatMaterial, legMaterial) {
  const group = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.46), seatMaterial);
  seat.position.y = 0.45;
  seat.castShadow = true;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.56, 0.12), seatMaterial);
  back.position.set(0, 0.78, -0.28);
  back.castShadow = true;
  group.add(back);

  [-0.17, 0.17].forEach((x) => {
    [-0.15, 0.15].forEach((z) => {
      const chairLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.45, 8), legMaterial);
      chairLeg.position.set(x, 0.23, z);
      chairLeg.castShadow = true;
      group.add(chairLeg);
    });
  });

  return group;
}

function createBooth(width, depth, seatMaterial, tableMaterial) {
  const group = new THREE.Group();
  group.name = 'Wall Booth';

  const bench = new THREE.Mesh(new THREE.BoxGeometry(width, 0.58, depth), seatMaterial);
  bench.position.y = 0.42;
  bench.castShadow = true;
  bench.receiveShadow = true;
  group.add(bench);

  const back = new THREE.Mesh(new THREE.BoxGeometry(width, 1.05, depth), seatMaterial);
  back.position.set(0, 0.88, 0);
  back.castShadow = true;
  group.add(back);

  const table = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, depth * 0.86), tableMaterial);
  table.position.set(width < 0.2 ? (width > 0 ? -0.58 : 0.58) : 0, 0.74, 0);
  table.castShadow = true;
  table.receiveShadow = true;
  group.add(table);

  return group;
}

function createFloorMat() {
  const mat = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.035, 0.92),
    new THREE.MeshStandardMaterial({ color: 0x32261f, roughness: 0.9 })
  );
  mat.receiveShadow = true;
  return mat;
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
  label.position.set(0, 2.68, 0);
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
      prepareModel(model, HERO_TARGET_HEIGHT);
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

function createCashierCounter() {
  const group = new THREE.Group();
  group.name = "McDonald's Cashier Counter";

  const fallback = new THREE.Mesh(
    new THREE.BoxGeometry(9, 1.1, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x2d2420, roughness: 0.68 })
  );
  fallback.position.y = 0.55;
  fallback.castShadow = true;
  fallback.receiveShadow = true;
  group.add(fallback);

  loadCashierCounterModel(group, fallback);

  return group;
}

function loadCashierCounterModel(group, fallback) {
  const loader = createHeroLoader(MCDONALDS_CASHIER_ASSET);
  const texture = loadCharacterTexture(MCDONALDS_CASHIER_TEXTURE);

  loader.load(
    MCDONALDS_CASHIER_ASSET,
    (loaded) => {
      const model = loaded.scene || loaded;
      prepareModel(model, CASHIER_COUNTER_TARGET_HEIGHT);
      applyTextureToModel(model, texture);
      model.rotation.y = Math.PI + MODEL_FACE_DOWN_OFFSET;
      group.remove(fallback);
      group.add(model);
    },
    undefined,
    () => {
      setStatus(`Could not load ${MCDONALDS_CASHIER_ASSET.split('/').pop()}`);
    }
  );
}

function createRepeatingTextureMaterial(asset, options) {
  const material = new THREE.MeshStandardMaterial({
    color: options.color,
    roughness: options.roughness,
    metalness: 0,
  });
  const [repeatX, repeatY] = options.repeat;

  new THREE.TextureLoader().load(
    asset,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeatX, repeatY);
      material.map = texture;
      material.needsUpdate = true;
    },
    undefined,
    () => {
      setStatus(`Could not load ${asset.split('/').pop()}`);
    }
  );

  return material;
}

function createExitMarker() {
  const group = new THREE.Group();
  group.name = 'Exit';

  const hitArea = new THREE.Mesh(
    new THREE.CircleGeometry(1.12, 48),
    new THREE.MeshBasicMaterial({
      color: 0x1d9bf0,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    })
  );
  hitArea.rotation.x = -Math.PI / 2;
  hitArea.position.y = 0.045;
  group.add(hitArea);

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
  playNPCAnimation(model, animations, ['idle', 'stand', 'breath'], {
    useFirstFallback: true,
  });
}

function playNPCAnimation(model, animations = [], names = [], options = {}) {
  const clips = removeRootMotionFromClips(animations);
  if (!clips.length) return false;

  const mixer = new THREE.AnimationMixer(model);
  const clip = findClip(clips, names) || (options.useFirstFallback ? clips[0] : null);
  if (!clip) return false;

  mixer.clipAction(clip).play();
  npcMixers.push(mixer);
  return true;
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
  if (gameState.world === 'mcdonaldsInterior') return interior.floor;
  if (gameState.world === 'luminaraCafeInterior') return cafeInterior.floor;
  return map;
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
  targetPosition.copy(constrainWalkPoint(point));
  targetPosition.y = 0;
  clickMarker.position.set(targetPosition.x, 0.05, targetPosition.z);
  clickMarker.visible = true;
  isMoving = true;
}

function constrainWalkPoint(point, previousPoint = hero?.position) {
  const constrained = point.clone();
  constrained.y = 0;
  const colliders = WALK_COLLIDERS[gameState.world] || [];

  colliders.forEach((collider) => {
    const bounds = expandCollider(collider, HERO_COLLISION_RADIUS);
    if (!isPointInCollider(constrained, bounds)) return;
    pushPointOutOfCollider(constrained, bounds, previousPoint);
  });

  return constrained;
}

function expandCollider(collider, margin) {
  return {
    minX: collider.minX - margin,
    maxX: collider.maxX + margin,
    minZ: collider.minZ - margin,
    maxZ: collider.maxZ + margin,
  };
}

function isPointInCollider(point, collider) {
  return point.x >= collider.minX
    && point.x <= collider.maxX
    && point.z >= collider.minZ
    && point.z <= collider.maxZ;
}

function pushPointOutOfCollider(point, collider, previousPoint) {
  if (previousPoint?.z >= collider.maxZ) {
    point.z = collider.maxZ;
    return;
  }
  if (previousPoint?.z <= collider.minZ) {
    point.z = collider.minZ;
    return;
  }
  if (previousPoint?.x <= collider.minX) {
    point.x = collider.minX;
    return;
  }
  if (previousPoint?.x >= collider.maxX) {
    point.x = collider.maxX;
    return;
  }

  const distances = [
    { axis: 'x', value: collider.minX, distance: Math.abs(point.x - collider.minX) },
    { axis: 'x', value: collider.maxX, distance: Math.abs(collider.maxX - point.x) },
    { axis: 'z', value: collider.minZ, distance: Math.abs(point.z - collider.minZ) },
    { axis: 'z', value: collider.maxZ, distance: Math.abs(collider.maxZ - point.z) },
  ];
  const nearest = distances.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best
  );
  point[nearest.axis] = nearest.value;
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

  if (target.kind === 'questItem') {
    interactWithQuestItem(target.id);
    return;
  }

  if (target.kind === 'exit') {
    exitInterior(target.id);
  }
}

function interactWithNPC(npcId) {
  const npc = NPCS.find((candidate) => candidate.id === npcId);
  if (!npc) return;

  const quest = QUESTS[npc.questId];
  if (!quest || gameState.completedQuestIds.has(quest.id)) {
    showDialog(npc.displayName, npc.bio);
    return;
  }

  if (!gameState.activeQuestId || gameState.questStage === 'not_started') {
    showDialog(
      npc.displayName,
      quest.dialog.offer,
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
    showDialog(npc.displayName, quest.dialog.accepted);
    return;
  }

  if (gameState.questStage === 'ordered') {
    showDialog(npc.displayName, quest.dialog.ordered);
    return;
  }

  if (gameState.questStage === 'collected') {
    gameState.inventory.delete(quest.itemId);
    gameState.completedQuestIds.add(quest.id);
    gameState.activeQuestId = null;
    gameState.questStage = 'not_started';
    gameState.readyAt = 0;
    saveQuestState();
    addFeed({ authorId: npc.id, text: quest.posts.complete });
    showDialog(npc.displayName, quest.dialog.collected);
    setStatus('Quest complete');
    updateQuestUI();
    updateQuestMarkers();
    return;
  }

  showDialog(npc.displayName, quest.dialog.completed || npc.bio);
}

function interactWithLocation(locationId) {
  const location = LOCATIONS.find((candidate) => candidate.id === locationId);
  if (!location) return;

  if (locationId === 'mcdonalds') {
    enterMcDonalds();
    return;
  }

  if (locationId === 'luminara_cafe') {
    enterLuminaraCafe();
    return;
  }

  showDialog(location.displayName, 'Nothing to do here yet.');
}

function interactWithCashier() {
  const quest = gameState.activeQuestId && QUESTS[gameState.activeQuestId];
  if (!quest || quest.type !== 'order' || gameState.questStage === 'not_started') {
    showDialog(CASHIER_DIALOG_NAME, quest?.dialog.cashierNoQuest || 'Welcome in. Nothing to prepare for you right now.');
    return;
  }

  if (gameState.questStage === 'accepted') {
    gameState.questStage = 'ordered';
    gameState.readyAt = Date.now() + quest.waitMs;
    saveQuestState();
    addFeed({ authorName: "McDonald's", handle: '@mcdonalds', text: quest.posts.ordered });
    showDialog(CASHIER_DIALOG_NAME, quest.dialog.cashierOrder);
    setStatus('Order placed');
    updateQuestUI();
    updateQuestMarkers();
    return;
  }

  if (gameState.questStage === 'ordered') {
    if (Date.now() < gameState.readyAt) {
      showDialog(CASHIER_DIALOG_NAME, quest.dialog.cashierWaiting);
      return;
    }

    gameState.inventory.add(quest.itemId);
    gameState.questStage = 'collected';
    saveQuestState();
    addFeed({ authorName: "McDonald's", handle: '@mcdonalds', text: quest.posts.pickedUp });
    showDialog(CASHIER_DIALOG_NAME, quest.dialog.cashierPickup);
    setStatus(`${quest.itemName} picked up`);
    updateQuestUI();
    updateQuestMarkers();
    return;
  }

  if (gameState.questStage === 'collected') {
    showDialog(CASHIER_DIALOG_NAME, quest.dialog.cashierAlreadyPickedUp);
    return;
  }

  showDialog(CASHIER_DIALOG_NAME, 'Thanks for stopping by.');
}

function interactWithQuestItem(itemId) {
  const item = QUEST_ITEMS.find((candidate) => candidate.id === itemId);
  const quest = Object.values(QUESTS).find((candidate) => candidate.pickupId === itemId);
  if (!item || !quest) return;

  if (gameState.activeQuestId !== quest.id || gameState.questStage !== 'accepted') {
    showDialog(item.displayName, quest.dialog.pickupHint || 'This might be useful later.');
    return;
  }

  gameState.inventory.add(quest.itemId);
  gameState.questStage = 'collected';
  saveQuestState();
  addFeed({ authorId: quest.giverId, text: quest.posts.pickedUp });
  showDialog(item.displayName, quest.dialog.pickupCollected || `You picked up ${quest.itemName}.`);
  setStatus(`${quest.itemName} found`);
  updateQuestUI();
  updateQuestMarkers();
}

function acceptQuest(quest, npc) {
  gameState.activeQuestId = quest.id;
  gameState.questStage = 'accepted';
  gameState.readyAt = 0;
  saveQuestState();
  addFeed({ authorId: npc.id, text: quest.posts.accepted });
  setStatus('Quest accepted');
  updateQuestUI();
  updateQuestMarkers();
}

function enterMcDonalds() {
  gameState.world = 'mcdonaldsInterior';
  setVisibleWorld('mcdonaldsInterior');
  scene.background = new THREE.Color(0x2d2621);
  pendingInteraction = null;
  isMoving = false;
  clickMarker.visible = false;
  hero.position.set(0, 0, 4.2);
  targetPosition.copy(hero.position);
  setStatus("Inside McDonald's");
}

function enterLuminaraCafe() {
  gameState.world = 'luminaraCafeInterior';
  setVisibleWorld('luminaraCafeInterior');
  scene.background = new THREE.Color(0x4b3327);
  pendingInteraction = null;
  isMoving = false;
  clickMarker.visible = false;
  hero.position.set(0, 0, 3.25);
  targetPosition.copy(hero.position);
  setStatus('Inside Luminara Coffee');
}

function setVisibleWorld(world) {
  outsideGroup.visible = world === 'outside';
  interiorGroup.visible = world === 'mcdonaldsInterior';
  cafeInteriorGroup.visible = world === 'luminaraCafeInterior';
}

function exitInterior(exitId) {
  if (exitId === 'luminara_cafe_exit') {
    exitLuminaraCafe();
    return;
  }

  exitMcDonalds();
}

function exitMcDonalds() {
  const location = locations.get('mcdonalds');
  gameState.world = 'outside';
  setVisibleWorld('outside');
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

function exitLuminaraCafe() {
  const location = locations.get('luminara_cafe');
  gameState.world = 'outside';
  setVisibleWorld('outside');
  scene.background = new THREE.Color(0x8db6c7);
  pendingInteraction = null;
  isMoving = false;
  clickMarker.visible = false;
  if (location) {
    hero.position.set(location.position.x + 1.85, 0, location.position.z + 2.45);
  }
  targetPosition.copy(hero.position);
  setStatus('Back outside');
}

function seedFeed() {
  const jessy = NPCS.find((npc) => npc.id === 'jessy');
  const luminara = NPCS.find((npc) => npc.id === 'luminara');
  const bigchog = NPCS.find((npc) => npc.id === 'bigchog');
  const quest = QUESTS.fries_for_jessy;
  addFeed({ authorId: jessy.id, text: quest.posts.start });
  addFeed({ authorId: luminara.id, text: QUESTS.coffee_beans_for_luminara.posts.start });
  addFeed({
    authorId: bigchog.id,
    text: 'vibecoding arc is evolving',
    replies: 128,
    reposts: 42,
    likes: '1.4K',
    views: '22K',
    bookmarks: 16,
  });
  addFeed({
    authorName: 'Vali | ATH 🇻🇳',
    handle: '@validotxyz',
    avatar: '/assets/vali/vali_pfp.jpeg',
    verifiedIcon: '/assets/checkmark.svg.png',
    text: 'Can you just send me some money?',
    replies: 19,
    reposts: 7,
    likes: 88,
    views: '4K',
    bookmarks: 3,
  });
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
  const npcStats = {
    jessy: { replies: 377, reposts: 80, likes: 762, views: '80K' },
    luminara: { replies: 42, reposts: 18, likes: 311, views: '12K' },
    bigchog: { replies: 128, reposts: 42, likes: '1.4K', views: '22K' },
  };
  const fixedStats = npcStats[npc?.id] || {};
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
  scrollFeedToBottom();
}

function scrollFeedToBottom() {
  if (!feedList || socialPanel?.classList.contains('is-collapsed')) return;

  const scroll = () => {
    feedList.scrollTop = feedList.scrollHeight;
  };
  requestAnimationFrame(scroll);
  window.setTimeout(scroll, 120);
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
    if (quest.type === 'pickup') {
      questChip.textContent = `${quest.title}: find ${quest.itemName}`;
      return;
    }
    questChip.textContent = `${quest.title}: order ${quest.itemName} at ${shop?.name || "McDonald's"}`;
    return;
  }

  if (gameState.questStage === 'ordered') {
    questChip.textContent = `${quest.title}: return later for pickup`;
    return;
  }

  if (gameState.questStage === 'collected') {
    questChip.textContent = `${quest.title}: return to ${giver?.name || quest.giverId}`;
    return;
  }

  questChip.textContent = `${quest.title}: complete`;
}

function updateQuestMarkers() {
  NPCS.forEach((npc) => {
    const root = npcs.get(npc.id);
    const marker = root?.userData.questMarker;
    const quest = QUESTS[npc.questId];
    if (!marker || !quest) return;

    const isCompleted = gameState.completedQuestIds.has(quest.id);
    const isActive = gameState.activeQuestId === quest.id;
    const canStartQuest = !gameState.activeQuestId && !isCompleted;
    const canCompleteQuest = isActive && gameState.questStage === 'collected';

    marker.visible = canStartQuest || canCompleteQuest;
    if (marker.visible) setQuestMarkerLabel(marker, canCompleteQuest ? '!' : '?');
  });

  QUEST_ITEMS.forEach((item) => {
    const root = questItems.get(item.id);
    const marker = root?.userData.questMarker;
    const quest = Object.values(QUESTS).find((candidate) => candidate.pickupId === item.id);
    if (!root || !marker || !quest) return;

    const shouldShow = gameState.activeQuestId === quest.id && gameState.questStage === 'accepted';
    root.visible = shouldShow;
    marker.visible = shouldShow;
    if (shouldShow) setQuestMarkerLabel(marker, '!');
  });
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
  updateBeggingActors();
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
  const nextPosition = hero.position.clone().add(heroVelocity);
  const constrainedPosition = constrainWalkPoint(nextPosition, hero.position);
  if (!constrainedPosition.equals(nextPosition)) {
    hero.position.copy(constrainedPosition);
    targetPosition.copy(constrainedPosition);
    clickMarker.visible = false;
    isMoving = false;
    if (pendingInteraction && flatDistance(hero.position, pendingInteraction.position) <= INTERACTION_DISTANCE) {
      const target = pendingInteraction;
      pendingInteraction = null;
      interact(target);
    } else {
      pendingInteraction = null;
      setStatus('Blocked');
    }
    setAnimation(false);
    return;
  }

  hero.position.copy(nextPosition);
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
  const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.07;
  [...npcs.values(), ...questItems.values()].forEach((root) => {
    const marker = root.userData.questMarker;
    if (!marker?.visible) return;

    const baseScale = marker.userData.baseScale || marker.scale;
    marker.scale.set(baseScale.x * pulse, baseScale.y * pulse, baseScale.z);
  });
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
