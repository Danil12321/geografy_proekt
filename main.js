import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ==========================================
// 1. СЦЕНА, КАМЕРА И РЕНДЕРЕР
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const DEFAULT_CAM_POS = new THREE.Vector3(0, 4, 10);
camera.position.copy(DEFAULT_CAM_POS);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 0.5;
controls.maxDistance = 200;

controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.NONE
};

// ==========================================
// ГЛОБАЛЬНЫЕ КОНСТАНТЫ И СОСТОЯНИЕ
// ==========================================
const EARTH_RADIUS = 1.5;

let selectedSat = null;
let hoveredSat = null;

// ==========================================
// ФИЧА 1: ЗОНА ПОКРЫТИЯ — 3D КОНУС + СФЕРИЧЕСКИЙ КУПОЛ
// ==========================================
let coverageCone = null;   // 3D-конус от спутника до Земли
let coverageDome = null;   // сферический сегмент, огибающий Землю
let currentCoverageCategory = '';

/**
 * Расчет параметров зоны покрытия в зависимости от высоты и класса спутника:
 *   - Starlink / МКС: узкий, острый конус и маленькое пятнышко на Земле
 *   - Sentinel (ДЗЗ): средний конус (полоса сканирования / swath)
 *   - GPS / ГЛОНАСС: широкий конус навигационного созвездия
 *   - GEO (Электро-Л): огромный охват почти всего полушария (~78°)
 */
function getCoverageParams(satRadius, category = currentCoverageCategory) {
    const R = EARTH_RADIUS;
    const r = Math.max(satRadius, R * 1.01);

    // Геометрический горизонт (максимально возможный угол на сфере)
    const horizonAngle = Math.acos(R / r);

    let earthAngle;
    if (category === 'Starlink') {
        earthAngle = 0.18; // ~10.3° — узкий острый конус, маленькое пятнышко
    } else if (category === 'ISS') {
        earthAngle = 0.22; // ~12.6° — локальный конус
    } else if (category === 'EO') {
        earthAngle = 0.40; // ~23° — средний конус сканирования (swath)
    } else if (category === 'GPS' || category === 'GLONASS') {
        earthAngle = 1.10; // ~63° — широкий конус MEO
    } else if (category === 'GEO') {
        earthAngle = 1.36; // ~78° — гигантский охват полушария
    } else {
        earthAngle = Math.min(1.36, Math.max(0.18, horizonAngle * 0.85));
    }

    const baseRadius = R * Math.sin(earthAngle);
    const coneHeight = r - R * Math.cos(earthAngle);
    return { earthAngle, baseRadius, coneHeight };
}

function createCoverage(sat) {
    removeCoverage();

    const color = sat.colorHex;
    currentCoverageCategory = sat.category;
    const { baseRadius, coneHeight, earthAngle } = getCoverageParams(sat.radius, sat.category);

    // 1. Динамический 3D-конус от спутника (вершина) до Земли (основание)
    // ConeGeometry: в локальных координатах вершина на +Y, основание на -Y
    const coneGeo = new THREE.ConeGeometry(baseRadius, coneHeight, 64, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.10,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    coverageCone = new THREE.Mesh(coneGeo, coneMat);
    coverageCone.renderOrder = 1;
    scene.add(coverageCone);

    // 2. Сферический сегмент на поверхности Земли (R = EARTH_RADIUS * 1.002, нет z-fighting)
    const domeR = EARTH_RADIUS * 1.002;
    const domeGeo = new THREE.SphereGeometry(
        domeR,
        64, 32,
        0, Math.PI * 2,
        0, earthAngle
    );
    const domeMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: sat.category === 'GEO' ? 0.15 : 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    coverageDome = new THREE.Mesh(domeGeo, domeMat);
    coverageDome.renderOrder = 2;

    // Контурное светящееся кольцо по периметру купола
    const ringPoints = [];
    const ringSegments = 96;
    const ringR = domeR * Math.sin(earthAngle);
    const ringY = domeR * Math.cos(earthAngle);
    for (let j = 0; j <= ringSegments; j++) {
        const phi = (j / ringSegments) * Math.PI * 2;
        ringPoints.push(new THREE.Vector3(ringR * Math.cos(phi), ringY, ringR * Math.sin(phi)));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringMat = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
    });
    const coverageRing = new THREE.LineLoop(ringGeo, ringMat);
    coverageRing.renderOrder = 3;
    coverageDome.add(coverageRing);

    scene.add(coverageDome);
}

function removeCoverage() {
    if (coverageCone) {
        scene.remove(coverageCone);
        coverageCone.geometry.dispose();
        coverageCone.material.dispose();
        coverageCone = null;
    }
    if (coverageDome) {
        scene.remove(coverageDome);
        coverageDome.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        coverageDome = null;
    }
}

// Вспомогательные векторы для анимации зоны покрытия (нулевой GC)
const _covUp      = new THREE.Vector3(0, 1, 0);
const _covSatDir  = new THREE.Vector3();
const _covQuat    = new THREE.Quaternion();
const _covConePos = new THREE.Vector3();

function updateCoverage(satWorldPos) {
    if (!coverageCone || !coverageDome) return;

    const r = satWorldPos.length();
    const { coneHeight } = getCoverageParams(r, currentCoverageCategory);

    // Направление от центра Земли к спутнику
    _covSatDir.copy(satWorldPos).normalize();

    // В ConeGeometry вершина на +Y, основание на -Y.
    // Чтобы вершина была у спутника, а основание на Земле,
    // ось +Y ориентируем ОТ Земли в сторону спутника (_covSatDir)
    _covQuat.setFromUnitVectors(_covUp, _covSatDir);
    coverageCone.quaternion.copy(_covQuat);

    // Позиция центра конуса — на половине высоты от спутника в сторону центра Земли
    _covConePos.copy(satWorldPos).addScaledVector(_covSatDir, -coneHeight * 0.5);
    coverageCone.position.copy(_covConePos);

    // Купол центрирован в (0,0,0) и ориентирован полюсом (+Y) к спутнику
    coverageDome.position.set(0, 0, 0);
    coverageDome.quaternion.copy(_covQuat);
}

// ==========================================
// ФИЧА 2: РЕЖИМ НАДИРА (NADIR CAM)
// ==========================================
let nadirMode = false;
const _nadirCamPos  = new THREE.Vector3();
const _nadirToEarth = new THREE.Vector3();
const _satForward   = new THREE.Vector3();

// ==========================================
// ЗАДАЧА 3: МАСШТАБ ВРЕМЕНИ (Time Scale)
// ==========================================
let timeScale = 1;

// ==========================================
// ЗАДАЧА 4: ОРБИТАЛЬНЫЙ СЛЕД (Orbit Trail)
// ==========================================
let orbitTrail = null;
const TRAIL_POINTS = 250;
const trailPositions = new Float32Array(TRAIL_POINTS * 3);


function createOrbitTrail() {
    if (orbitTrail) {
        scene.remove(orbitTrail);
        orbitTrail.geometry.dispose();
        orbitTrail.material.dispose();
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions.slice(), 3));
    const trailMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.0,
        vertexColors: false,
        depthWrite: false
    });
    orbitTrail = new THREE.Line(trailGeo, trailMat);
    orbitTrail.frustumCulled = false;
    scene.add(orbitTrail);
}

function updateTrailForSat(sat) {
    if (!sat || !orbitTrail) return;
    // Пересчитываем точки — рисуем прошлые 250 позиций орбиты
    const a = sat.radius;
    const b = sat.semiMinor;
    const c = sat.isElliptical ? Math.sqrt(a * a - b * b) : 0;
    const angleStep = (2 * Math.PI) / TRAIL_POINTS;

    const posArr = orbitTrail.geometry.attributes.position.array;
    for (let i = 0; i < TRAIL_POINTS; i++) {
        const theta = sat.angle - i * angleStep;
        const lx = a * Math.cos(theta) - c;
        const lz = b * Math.sin(theta);

        const localVec = new THREE.Vector3(lx, 0, lz);
        // Переводим из локального пространства плоскости в мировое
        sat.planeGroup.localToWorld(localVec);

        posArr[i * 3]     = localVec.x;
        posArr[i * 3 + 1] = localVec.y;
        posArr[i * 3 + 2] = localVec.z;
    }
    orbitTrail.geometry.attributes.position.needsUpdate = true;
    orbitTrail.material.color.set(sat.colorHex);
    orbitTrail.material.opacity = 0.65;
}

function clearTrail() {
    if (orbitTrail) {
        orbitTrail.material.opacity = 0.0;
    }
}

// ==========================================
// 2. ИНТЕРФЕЙС (UI)
// ==========================================
const infoCard = document.createElement('div');
infoCard.id = 'sat-info-card';
infoCard.style.cssText = `
    position: absolute; top: 20px; right: 20px; width: 320px;
    background: rgba(10, 15, 30, 0.92); backdrop-filter: blur(12px);
    border: 1px solid rgba(0, 240, 255, 0.5); border-radius: 12px;
    padding: 18px; color: #ffffff; font-family: system-ui, sans-serif;
    box-shadow: 0 0 30px rgba(0, 240, 255, 0.2); display: none;
    pointer-events: none; z-index: 1000; line-height: 1.5;
`;
document.body.appendChild(infoCard);

const controlPanel = document.createElement('div');
controlPanel.id = 'control-panel';
controlPanel.style.cssText = `
    position: absolute; top: 20px; left: 20px; width: 260px;
    background: rgba(10, 15, 30, 0.88); backdrop-filter: blur(10px);
    border: 1px solid rgba(0, 240, 255, 0.3); border-radius: 12px;
    padding: 16px; color: #ffffff; font-family: system-ui, sans-serif;
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.5); z-index: 1000;
`;
controlPanel.innerHTML = `
    <div style="font-size: 14px; font-weight: bold; color: #00f0ff; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px;">Управление</div>

    <div style="margin-bottom: 12px;">
        <label style="font-size: 12px; color: #a0c0d0; display: block; margin-bottom: 4px;">Фильтр систем:</label>
        <select id="system-filter" style="width: 100%; background: #101828; color: #fff; border: 1px solid #00f0ff; padding: 6px; border-radius: 6px; cursor: pointer;">
            <option value="ALL">Все спутники</option>
            <option value="GPS">GPS</option>
            <option value="GLONASS">ГЛОНАСС</option>
            <option value="Starlink">Starlink</option>
            <option value="EO">ДЗЗ</option>
            <option value="GEO">Геостационарные</option>
            <option value="ISS">МКС</option>
        </select>
    </div>

    <div style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 12px; color: #a0c0d0;">Орбиты:</span>
        <input type="checkbox" id="orbit-toggle" checked style="cursor: pointer;">
    </div>

    <div style="margin-bottom: 14px;">
        <label style="font-size: 12px; color: #a0c0d0; display: block; margin-bottom: 6px;">
            ⏩ Масштаб времени: <span id="timescale-label" style="color:#00f0ff; font-weight:bold;">×1</span>
        </label>
        <div style="display: flex; gap: 6px;">
            <button class="ts-btn" data-scale="1"  style="flex:1; padding:5px 0; background:rgba(0,240,255,0.25); border:1px solid #00f0ff; color:#00f0ff; border-radius:5px; cursor:pointer; font-weight:bold;">×1</button>
            <button class="ts-btn" data-scale="10" style="flex:1; padding:5px 0; background:rgba(0,240,255,0.08); border:1px solid #00f0ff; color:#00f0ff; border-radius:5px; cursor:pointer;">×10</button>
            <button class="ts-btn" data-scale="50" style="flex:1; padding:5px 0; background:rgba(0,240,255,0.08); border:1px solid #00f0ff; color:#00f0ff; border-radius:5px; cursor:pointer;">×50</button>
        </div>
        <div style="font-size: 10px; color: #607080; margin-top: 5px;">LEO ≈ 90 мин · GEO = 24 ч · MEO ≈ 12 ч</div>
    </div>

    <button id="reset-cam-btn" style="width: 100%; padding: 8px; background: rgba(0, 240, 255, 0.15); border: 1px solid #00f0ff; color: #00f0ff; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s;">
        Сбросить камеру
    </button>
`;
document.body.appendChild(controlPanel);

// ==========================================
// 3. ЗВЁЗДНОЕ НЕБО
// ==========================================
const starsGeometry = new THREE.BufferGeometry();
const starsCount = 10000;
const positions = new Float32Array(starsCount * 3);
for (let i = 0; i < starsCount * 3; i += 3) {
    const r = 400 + Math.random() * 100;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    positions[i] = r * Math.sin(phi) * Math.cos(theta);
    positions[i + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i + 2] = r * Math.cos(phi);
}
starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const stars = new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: true }));
scene.add(stars);

// ==========================================
// 4. ОСВЕЩЕНИЕ И КОСМИЧЕСКИЕ ТЕЛА
// ==========================================
const ambientLight = new THREE.AmbientLight(0xffffff, 0.05);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
sunLight.position.set(30, 15, 30);
scene.add(sunLight);

const backLight = new THREE.DirectionalLight(0x88bbff, 0.35);
backLight.position.set(-30, -15, -30);
scene.add(backLight);

function createGlowTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 1)`);
    gradient.addColorStop(0.2, `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`);
    gradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, 0.3)`);
    gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(canvas);
}

// СОЛНЦЕ
const sun = new THREE.Mesh(
    new THREE.SphereGeometry(15, 64, 64),
    new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load('sun.jpg') })
);
sun.position.set(170, 85, 170);
scene.add(sun);

const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: createGlowTexture({ r: 255, g: 200, b: 80 }),
    transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false
}));
sunGlow.scale.set(80, 80, 1);
sunGlow.position.copy(sun.position);
scene.add(sunGlow);

// ЛУНА И ЕЁ ОРБИТА
const MOON_DISTANCE = 11.5;
const MOON_INCLINATION = THREE.MathUtils.degToRad(5.14);
let moonAngle = 0;

const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 32, 32),
    new THREE.MeshStandardMaterial({
        map: new THREE.TextureLoader().load('moon.jpg'),
        roughness: 1.0
    })
);
scene.add(moon);

const moonOrbitPoints = [];
for (let i = 0; i <= 128; i++) {
    const theta = (i / 128) * Math.PI * 2;
    moonOrbitPoints.push(new THREE.Vector3(
        MOON_DISTANCE * Math.cos(theta),
        MOON_DISTANCE * Math.sin(theta) * Math.sin(MOON_INCLINATION),
        MOON_DISTANCE * Math.sin(theta) * Math.cos(MOON_INCLINATION)
    ));
}
const moonOrbitLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(moonOrbitPoints),
    new THREE.LineBasicMaterial({ color: 0x557799, transparent: true, opacity: 0.35 })
);
scene.add(moonOrbitLine);

// ==========================================
// 5. ЗЕМЛЯ И ОБЛАКА
// ==========================================
const textureLoader = new THREE.TextureLoader();

// Генерируем процедурную specular-карту (белый = вода, чёрный = суша)
// — заглушка, так как earth_specular.jpg отсутствует
function createSpecularFallback() {
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#336699';  // синеватый — имитирует преобладание воды
    ctx.fillRect(0, 0, 2, 1);
    return new THREE.CanvasTexture(canvas);
}

const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
        dayTexture:      { value: textureLoader.load('earth_day.jpg') },
        nightTexture:    { value: textureLoader.load('earth_night.jpg') },
        specularTexture: { value: createSpecularFallback() },
        sunDirection:    { value: new THREE.Vector3(30, 15, 30).normalize() }
    },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        
        void main() {
            vUv = uv;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `,
    fragmentShader: `
        uniform sampler2D dayTexture;
        uniform sampler2D nightTexture;
        uniform sampler2D specularTexture;
        uniform vec3 sunDirection;
        
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        
        void main() {
            float intensity = dot(vWorldNormal, sunDirection);
            float mixAmount = smoothstep(-0.1, 0.2, intensity);
            
            vec4 dayColor   = texture2D(dayTexture, vUv);
            vec4 nightColor = texture2D(nightTexture, vUv);
            float specMask  = texture2D(specularTexture, vUv).r;
            
            vec3 viewDir    = normalize(cameraPosition - vWorldPosition);
            vec3 reflectDir = reflect(-sunDirection, vWorldNormal);
            float spec      = pow(max(dot(viewDir, reflectDir), 0.0), 35.0);
            vec3 specularHighlight = vec3(0.6) * spec * specMask;
            
            vec3 nightWithAmbient = nightColor.rgb + vec3(0.02, 0.03, 0.05);
            vec3 finalDayColor    = dayColor.rgb + specularHighlight;
            
            gl_FragColor = vec4(mix(nightWithAmbient, finalDayColor, mixAmount), 1.0);
        }
    `
});

const sphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 64, 64), earthMaterial);
scene.add(sphere);

const cloudsSphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 64, 64),
    new THREE.MeshStandardMaterial({
        map: textureLoader.load('earth_clouds.jpg'),
        transparent: true, opacity: 0.4, depthWrite: false
    })
);
scene.add(cloudsSphere);

// ==========================================
// 6. СПУТНИКИ И ОРБИТЫ
// ==========================================
const satelliteObjects = [];
const orbitLines = [];

function createSatelliteMesh(colorHex) {
    const group = new THREE.Group();
    
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.08),
        new THREE.MeshStandardMaterial({ 
            color: colorHex, 
            metalness: 0.8, 
            roughness: 0.2,
            emissive: colorHex,
            emissiveIntensity: 0.35 
        })
    );
    group.add(body);

    const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.01, 0.05),
        new THREE.MeshStandardMaterial({ 
            color: 0x002288, 
            metalness: 0.9, 
            roughness: 0.1,
            emissive: 0x002288,
            emissiveIntensity: 0.2 
        })
    );
    group.add(panel);

    return group;
}

function createOrbitLine(radius, colorHex, category, semiMinor = radius, isElliptical = false) {
    const points = [];
    const segments = 128;
    const a = radius;
    const b = semiMinor;
    const c = isElliptical ? Math.sqrt(a * a - b * b) : 0;

    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(a * Math.cos(theta) - c, 0, b * Math.sin(theta)));
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(points);
    const orbitMat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.35 });
    const line = new THREE.LineLoop(orbitGeo, orbitMat);
    
    orbitLines.push({ line: line, category: category });
    return line;
}

// ==========================================
// ЗАДАЧА 2: ДИНАМИЧЕСКИЕ СТАТУСЫ
// ==========================================

// --- Sentinel / ДЗЗ: живые геоданные ---
const ndviNames  = ['Средняя Сибирь', 'Амазония', 'Центральная Африка', 'Канадская тайга', 'Индо-Ганг'];
const ndviStates = [
    { emoji: '🟢', label: 'Здоровая растительность' },
    { emoji: '🟡', label: 'Умеренный стресс' },
    { emoji: '🔴', label: 'Деградация / вырубка' }
];
const waterBodies = ['р. Обь', 'р. Амазонка', 'оз. Чад', 'р. Инд', 'р. Меконг'];
const burnEvents  = ['Южная Сибирь', 'Сакраменто', 'Юго-Вост. Австралия', 'Ла-Платская низменность'];

function getEOStatus(sat) {
    const t = Date.now() / 1000;
    const phase = Math.floor(t / 8 + sat.angle * 10) % 5; // меняется каждые 8 сек
    switch (phase) {
        case 0: {
            const ndvi = (0.35 + 0.5 * Math.abs(Math.sin(t * 0.07 + sat.angle * 3))).toFixed(2);
            const st   = ndviStates[ndvi < 0.45 ? 2 : ndvi < 0.65 ? 1 : 0];
            const zone = ndviNames[Math.floor(sat.angle * 7) % ndviNames.length];
            return `📡 NDVI над ${zone}: <b style="color:#adff2f">${ndvi}</b> ${st.emoji} ${st.label}`;
        }
        case 1: {
            const lvl = (2.1 + 1.8 * Math.abs(Math.sin(t * 0.05))).toFixed(1);
            const wb  = waterBodies[Math.floor(t / 8) % waterBodies.length];
            const trend = lvl > 3.3 ? '<span style="color:#ff4444">▲ УГРОЗА ПАВОДКА</span>' : '<span style="color:#88ccff">норма</span>';
            return `🌊 Уровень воды ${wb}: +${lvl} м — ${trend}`;
        }
        case 2: {
            const pct = (0.3 + 2.4 * Math.abs(Math.sin(t * 0.03))).toFixed(1);
            const region = burnEvents[Math.floor(t / 8) % burnEvents.length];
            return `🔥 Активные пожары / ${region}: площадь <b style="color:#ff8844">${pct} тыс. км²</b>`;
        }
        case 3: {
            const bands = ['B02-B03-B04 (RGB)', 'B08 (NIR)', 'B11-B12 (SWIR)', 'B05-B06-B07 (RedEdge)'];
            return `📸 Съёмка в диапазоне: <b>${bands[Math.floor(t / 8) % bands.length]}</b>, разреш. 10 м`;
        }
        default: {
            return `⏳ Передача данных → ESAC: <b style="color:#00f0ff">${(Math.random() * 100).toFixed(0)}%</b>`;
        }
    }
}

// --- GPS / ГЛОНАСС: эфемериды и атомные часы ---
function getNavStatus(sat) {
    const t = Date.now() / 1000;
    const phase = Math.floor(t / 7 + sat.angle * 5) % 4;
    const isGPS = sat.category === 'GPS';

    switch (phase) {
        case 0: {
            const drift = (Math.random() * 0.08).toFixed(3);
            const clock = isGPS ? 'Rb/Cs атомные часы' : 'Cs-133 стандарт';
            return `⏱ ${clock}: дрейф <b style="color:#00ff88">${drift} нс/сут</b>`;
        }
        case 1: {
            const elev = (10 + 70 * Math.abs(Math.sin(t * 0.04 + sat.angle))).toFixed(1);
            return `📡 Эфемериды переданы: ΔUоRS = <b>${(Math.random() * 3).toFixed(2)} м</b>, угол возвышения ${elev}°`;
        }
        case 2: {
            const sats = isGPS ? '8/24 видимых' : '7/24 видимых';
            const pdop = (1.2 + 1.8 * Math.abs(Math.sin(t * 0.06))).toFixed(1);
            return `🌐 Созвездие: ${sats}, PDOP = <b style="color:#${parseFloat(pdop) < 2 ? '00ff88' : 'ffaa00'}">${pdop}</b>`;
        }
        default: {
            const corr = `${isGPS ? '+' : '−'}${(Math.random() * 12).toFixed(1)} мкс`;
            return `🔧 Коррекция ионосферной задержки: <b style="color:#88ddff">${corr}</b>`;
        }
    }
}

// --- Starlink: телекоммуникации ---
function getStarlinkStatus(sat) {
    const t = Date.now() / 1000;
    const phase = Math.floor(t / 6 + sat.angle * 8) % 3;
    switch (phase) {
        case 0: {
            const dl = (80 + 120 * Math.random()).toFixed(1);
            const ul = (10 + 30 * Math.random()).toFixed(1);
            return `📶 Трафик: ↓${dl} Мбит/с · ↑${ul} Мбит/с`;
        }
        case 1: {
            const lat = (20 + 15 * Math.abs(Math.sin(t * 0.03))).toFixed(1);
            return `⚡ Задержка: <b style="color:#${lat < 30 ? '00ff88' : 'ffaa00'}">${lat} мс</b> · межспутниковый лазер`;
        }
        default:
            return `🛰 Маршрутизация пакетов · Наклонение ${(53 + Math.random()).toFixed(1)}°`;
    }
}

// --- МКС: научные данные ---
function getISSStatus() {
    const t = Date.now() / 1000;
    const phase = Math.floor(t / 9) % 4;
    const experiments = ['кристаллизация белков', 'ростки Arabidopsis', 'плазменный кристалл', 'испытание СКМ-У'];
    switch (phase) {
        case 0:
            return `🧪 Эксперимент: <b>${experiments[Math.floor(t / 9) % experiments.length]}</b>`;
        case 1: {
            const O2 = (20.8 + 0.3 * Math.sin(t * 0.02)).toFixed(1);
            return `🌬 Атмосфера: O₂ ${O2}%, CO₂ ${(0.35 + 0.1 * Math.sin(t)).toFixed(2)}%`;
        }
        case 2: {
            const orbit = Math.floor(19591 + t / 5560) % 100000; // ~5560 сек / виток
            return `🔄 Виток: <b style="color:#ff8800">#${orbit}</b> · период ~92 мин`;
        }
        default:
            return `📡 Связь: Ku-диапазон 25 Мбит/с · NASA Houston`;
    }
}

// --- GEO / Метеорология ---
function getGEOStatus() {
    const t = Date.now() / 1000;
    const phase = Math.floor(t / 10) % 3;
    const channels = ['ИК 10.5 мкм', 'Водяной пар 6.2 мкм', 'Видимый 0.65 мкм'];
    switch (phase) {
        case 0: {
            const temp = (-45 + 10 * Math.sin(t * 0.02)).toFixed(1);
            return `🌡 ТОО облачного покрова: <b>${temp} °C</b> · канал ${channels[Math.floor(t/10) % 3]}`;
        }
        case 1:
            return `🌀 Циклон отслеживается: Vmax = <b style="color:#ff4444">${(120 + 40 * Math.abs(Math.sin(t * 0.01))).toFixed(0)} км/ч</b>`;
        default:
            return `📸 Снимок диска Земли каждые <b>30 мин</b> · разреш. 1 км`;
    }
}

function getDynamicStatus(sat) {
    if (sat.info.isRemoteSensing)        return getEOStatus(sat);
    if (sat.category === 'GPS')          return getNavStatus(sat);
    if (sat.category === 'GLONASS')      return getNavStatus(sat);
    if (sat.category === 'Starlink')     return getStarlinkStatus(sat);
    if (sat.category === 'ISS')          return getISSStatus();
    if (sat.category === 'GEO')          return getGEOStatus();
    return sat.info.status || '● Активен';
}

// ==========================================
// КОНФИГУРАЦИИ ГРУППИРОВОК
// ==========================================
function addSatelliteConstellation({ name, category, count, planes, radius, semiMinor, inclination, speed, color, info }) {
    const satsPerPlane = Math.ceil(count / planes);
    const isElliptical = Boolean(semiMinor && semiMinor !== radius);
    const b = semiMinor || radius;

    for (let p = 0; p < planes; p++) {
        const planeAngle = (p / planes) * Math.PI * 2;

        const planeGroup = new THREE.Group();
        planeGroup.rotation.y = planeAngle;
        planeGroup.rotation.x = inclination;
        scene.add(planeGroup);

        const orbitLine = createOrbitLine(radius, color, category, b, isElliptical);
        planeGroup.add(orbitLine);

        for (let s = 0; s < satsPerPlane; s++) {
            const initialAngle = (s / satsPerPlane) * Math.PI * 2 + (p * 0.3);
            const satMesh = createSatelliteMesh(color);

            const c = isElliptical ? Math.sqrt(radius * radius - b * b) : 0;
            satMesh.position.x = radius * Math.cos(initialAngle) - c;
            satMesh.position.z = b * Math.sin(initialAngle);
            satMesh.rotation.y = -initialAngle;

            planeGroup.add(satMesh);

            satelliteObjects.push({
                mesh: satMesh,
                planeGroup: planeGroup,
                category: category,
                radius: radius,
                semiMinor: b,
                isElliptical: isElliptical,
                angle: initialAngle,
                speed: speed,
                colorHex: color,
                info: {
                    ...info,
                    fullName: `${name} #${p * satsPerPlane + s + 1}`
                }
            });
        }
    }
}

// ИНИЦИАЛИЗАЦИЯ СИСТЕМ
addSatelliteConstellation({ name: 'GPS IIF/III', category: 'GPS', count: 24, planes: 6, radius: EARTH_RADIUS * 3.8, inclination: THREE.MathUtils.degToRad(55), speed: 0.0008, color: 0x00f0ff, info: { system: 'GPS (NAVSTAR, США)', altitude: '~20 200 км (MEO)', type: 'Спутниковая навигация', purpose: 'Передача точных сигналов времени и координат.' } });
addSatelliteConstellation({ name: 'ГЛОНАСС-К', category: 'GLONASS', count: 24, planes: 3, radius: EARTH_RADIUS * 3.6, inclination: THREE.MathUtils.degToRad(64.8), speed: 0.0009, color: 0x00ff66, info: { system: 'ГЛОНАСС (Россия)', altitude: '~19 100 км (MEO)', type: 'Спутниковая навигация', purpose: 'Глобальное навигационное обеспечение.' } });
addSatelliteConstellation({ name: 'Starlink v2-Mini', category: 'Starlink', count: 48, planes: 6, radius: EARTH_RADIUS * 1.08, inclination: THREE.MathUtils.degToRad(53), speed: 0.0035, color: 0xffffff, info: { system: 'Starlink (SpaceX, США)', altitude: '~550 км (LEO)', type: 'Низкоорбитальный интернет', purpose: 'Широкополосный интернет по всему миру.' } });
addSatelliteConstellation({ name: 'Sentinel-2A', category: 'EO', count: 6, planes: 3, radius: EARTH_RADIUS * 1.25, inclination: THREE.MathUtils.degToRad(98), speed: 0.002, color: 0xffd700, info: { system: 'Copernicus / ESA', altitude: '~705–786 км (Полярная LEO)', type: 'ДЗЗ — Экологический мониторинг', purpose: 'Мониторинг лесов, паводков, сельхозугодий и качества почв. NDVI, SWIR, NIR-анализ.', isRemoteSensing: true } });
addSatelliteConstellation({ name: 'Электро-Л', category: 'GEO', count: 4, planes: 1, radius: EARTH_RADIUS * 5.2, inclination: 0, speed: 0.0004, color: 0xff00ff, info: { system: 'Геостационарная метеосеть (Россия)', altitude: '~35 786 км (GEO)', type: 'Метеорология', purpose: 'Непрерывное наблюдение за атмосферой Земли и мониторинг опасных явлений.' } });
addSatelliteConstellation({ name: 'МКС (ISS)', category: 'ISS', count: 1, planes: 1, radius: EARTH_RADIUS * 1.15, inclination: THREE.MathUtils.degToRad(51.6), speed: 0.0025, color: 0xff8800, info: { system: 'МКС (Россия / США / ЕКА)', altitude: '~420 км (LEO)', type: 'Пилотируемая орбитальная станция', purpose: 'Научные исследования в условиях микрогравитации, наблюдения за поверхностью Земли.' } });

// Создаём начальный след
createOrbitTrail();

// ==========================================
// 7. ИНТЕРАКТИВНОСТЬ И ВЫБОР
// ==========================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function updateInfoCard(sat) {
    const hexColor = sat.colorHex.toString(16).padStart(6, '0');
    const i = sat.info;

    // Активируем pointer-events чтобы кнопки внутри карточки работали
    infoCard.style.display = 'block';
    infoCard.style.pointerEvents = 'auto';

    // Вычисляем угол покрытия для метки
    const { earthAngle } = getCoverageParams(sat.radius);
    const fpAngleDeg = (earthAngle * 180 / Math.PI).toFixed(1);
    const fpLabel    = sat.category === 'GEO'
        ? `~${fpAngleDeg}° (полушарие)`
        : (sat.category === 'GPS' || sat.category === 'GLONASS')
            ? `~${fpAngleDeg}° (MEO широкое)`
            : sat.info.isRemoteSensing
                ? `~${fpAngleDeg}° (полярная полоса)`
                : `~${fpAngleDeg}°`;

    infoCard.innerHTML = `
        <div style="color: #${hexColor}; font-size: 16px; font-weight: bold; margin-bottom: 6px;">
            ${i.fullName}
        </div>
        <div style="font-size: 12px; color: #a0c0d0; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 6px;">
            <b>Система:</b> ${i.system}
        </div>
        <div style="margin-bottom: 4px;"><b>Высота орбиты:</b> ${i.altitude}</div>
        <div style="margin-bottom: 4px;"><b>Тип:</b> ${i.type}</div>
        <div style="margin-bottom: 8px; font-size: 12px; color: #88ddff;">
            🌐 Зона покрытия: <b style="color:#${hexColor}">${fpLabel}</b>
        </div>
        <div style="font-size: 12px; color: #d0e8f5; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; margin-bottom: 10px;">
            ${i.purpose}
        </div>
        <div id="dyn-status" style="font-size: 12px; color: #ccffcc; background: rgba(0,60,0,0.3); padding: 7px 8px; border-radius: 6px; margin-bottom: 10px; min-height: 34px; line-height: 1.5;">
            ● Загрузка…
        </div>
        <div style="font-size: 12px; color: #ffaa00; font-family: monospace; background: rgba(255, 170, 0, 0.1); padding: 6px; border-radius: 4px; margin-bottom: 10px;">
            Широта: <span id="ui-lat">0.00°</span><br>
            Долгота: <span id="ui-lon">0.00°</span>
        </div>
        <div style="display: flex; gap: 6px;">
            <button id="nadir-btn" style="
                flex:1; padding:7px 4px; font-size:11px; font-weight:bold; cursor:pointer;
                background:rgba(255,140,0,0.2); border:1px solid #ff8c00;
                color:#ff8c00; border-radius:6px; transition:0.2s;
            ">🔭 Вид из аппарата</button>
            <button id="nadir-exit-btn" style="
                flex:1; padding:7px 4px; font-size:11px; font-weight:bold; cursor:pointer;
                background:rgba(0,240,255,0.12); border:1px solid #00f0ff;
                color:#00f0ff; border-radius:6px; display:none; transition:0.2s;
            ">↩ Свободная камера</button>
        </div>
    `;

    // Кнопка «Вид из аппарата»
    document.getElementById('nadir-btn').addEventListener('click', () => {
        nadirMode = true;
        controls.enabled = false;
        if (selectedSat) {
            selectedSat.mesh.scale.set(1.0, 1.0, 1.0); // возвращаем обычный масштаб, чтобы корпус не закрывал обзор
        }
        document.getElementById('nadir-btn').style.display      = 'none';
        document.getElementById('nadir-exit-btn').style.display = 'block';
    });

    // Кнопка «Свободная камера»
    document.getElementById('nadir-exit-btn').addEventListener('click', () => {
        exitNadirMode();
    });

    // Создаём 3D-конус и сферический купол покрытия
    createCoverage(sat);
}

function exitNadirMode() {
    nadirMode = false;
    camera.up.set(0, 1, 0); // восстанавливаем вертикальную ось сцены
    controls.enabled = true;
    if (selectedSat) {
        selectedSat.mesh.scale.set(2.5, 2.5, 2.5); // возвращаем акцент на спутнике в орбитальном виде
    }
    const nb = document.getElementById('nadir-btn');
    const ne = document.getElementById('nadir-exit-btn');
    if (nb) nb.style.display = 'block';
    if (ne) ne.style.display = 'none';
}

function resetCamera() {
    if (selectedSat) {
        selectedSat.mesh.scale.set(1, 1, 1);
        selectedSat = null;
    }
    if (hoveredSat) {
        hoveredSat.mesh.scale.set(1, 1, 1);
        hoveredSat = null;
    }
    infoCard.style.display = 'none';
    infoCard.style.pointerEvents = 'none';
    clearTrail();
    removeCoverage();
    exitNadirMode();

    controls.target.set(0, 0, 0);
    camera.position.copy(DEFAULT_CAM_POS);

    controls.update();
}

window.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const visibleMeshes = satelliteObjects.filter(s => s.mesh.visible).map(s => s.mesh);
    const intersects = raycaster.intersectObjects(visibleMeshes, true);

    if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj.parent && !satelliteObjects.find(s => s.mesh === obj)) obj = obj.parent;
        const foundSat = satelliteObjects.find(s => s.mesh === obj);

        if (foundSat) {
            document.body.style.cursor = 'pointer';
            if (hoveredSat !== foundSat && foundSat !== selectedSat) {
                if (hoveredSat && hoveredSat !== selectedSat) hoveredSat.mesh.scale.set(1, 1, 1);
                hoveredSat = foundSat;
                hoveredSat.mesh.scale.set(2.2, 2.2, 2.2);
            }
        }
    } else {
        document.body.style.cursor = 'default';
        if (hoveredSat && hoveredSat !== selectedSat) {
            hoveredSat.mesh.scale.set(1, 1, 1);
            hoveredSat = null;
        }
    }
});

window.addEventListener('click', () => {
    if (hoveredSat) {
        if (selectedSat && selectedSat !== hoveredSat) {
            selectedSat.mesh.scale.set(1, 1, 1);
        }
        selectedSat = hoveredSat;
        selectedSat.mesh.scale.set(2.5, 2.5, 2.5);

        updateInfoCard(selectedSat);

        const satWorldPos = new THREE.Vector3();
        selectedSat.mesh.getWorldPosition(satWorldPos);
        controls.target.copy(satWorldPos);
    }
});

// ==========================================
// 8. ЛОГИКА UI И ФИЛЬТРОВ
// ==========================================
document.getElementById('orbit-toggle').addEventListener('change', (e) => {
    const selectedFilter = document.getElementById('system-filter').value;
    orbitLines.forEach(item => {
        const matchesFilter = (selectedFilter === 'ALL' || item.category === selectedFilter);
        item.line.visible = matchesFilter && e.target.checked;
    });
    moonOrbitLine.visible = e.target.checked;
});

document.getElementById('system-filter').addEventListener('change', (e) => {
    const selected = e.target.value;
    const isOrbitEnabled = document.getElementById('orbit-toggle').checked;

    satelliteObjects.forEach(sat => {
        sat.mesh.visible = (selected === 'ALL' || sat.category === selected);
    });

    orbitLines.forEach(item => {
        const matchesFilter = (selected === 'ALL' || item.category === selected);
        item.line.visible = matchesFilter && isOrbitEnabled;
    });

    if (selectedSat && !selectedSat.mesh.visible) {
        resetCamera();
    }
});

document.getElementById('reset-cam-btn').addEventListener('click', () => {
    resetCamera();
});

// --- Кнопки масштаба времени ---
document.querySelectorAll('.ts-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        timeScale = parseFloat(btn.dataset.scale);
        document.getElementById('timescale-label').textContent = `×${timeScale}`;

        document.querySelectorAll('.ts-btn').forEach(b => {
            b.style.background = 'rgba(0,240,255,0.08)';
            b.style.fontWeight = 'normal';
        });
        btn.style.background = 'rgba(0,240,255,0.28)';
        btn.style.fontWeight = 'bold';
    });
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// 9. ЦИКЛ АНИМАЦИИ
// ==========================================
const currentSatPos = new THREE.Vector3();
const prevSatPos    = new THREE.Vector3();

// Счётчик кадров для обновления статусов (раз в ~60 кадров = ~1 сек)
let frameCounter = 0;

function animate() {
    requestAnimationFrame(animate);
    frameCounter++;

    // Вращение Земли (масштабируется временем)
    sphere.rotation.y      += 0.0012 * timeScale;
    cloudsSphere.rotation.y += 0.0015 * timeScale;

    // Движение Луны
    moonAngle += 0.0003 * timeScale;
    moon.position.x = MOON_DISTANCE * Math.cos(moonAngle);
    moon.position.y = MOON_DISTANCE * Math.sin(moonAngle) * Math.sin(MOON_INCLINATION);
    moon.position.z = MOON_DISTANCE * Math.sin(moonAngle) * Math.cos(MOON_INCLINATION);
    moon.rotation.y += 0.0005 * timeScale;

    // Движение спутников
    satelliteObjects.forEach(sat => {
        if (sat === selectedSat) {
            sat.mesh.getWorldPosition(prevSatPos);
        }

        sat.angle += sat.speed * timeScale;
        const a = sat.radius;
        const b = sat.semiMinor;
        const c = sat.isElliptical ? Math.sqrt(a * a - b * b) : 0;

        sat.mesh.position.x = a * Math.cos(sat.angle) - c;
        sat.mesh.position.z = b * Math.sin(sat.angle);
        sat.mesh.rotation.y = -sat.angle;
    });

    // Слежение камеры + координаты + обновление динамического статуса
    if (selectedSat && selectedSat.mesh.visible) {
        selectedSat.mesh.getWorldPosition(currentSatPos);

        if (nadirMode) {
            // --- РЕЖИМ НАДИРА: кинематографичный вид из аппарата на Землю ---
            // Вектор от спутника строго в центр Земли (надир)
            _nadirToEarth.copy(currentSatPos).negate().normalize();

            // Вектор направления орбитального движения (forward)
            const _satVelocity = currentSatPos.clone().sub(prevSatPos);
            if (_satVelocity.lengthSq() > 1e-8) {
                _satForward.copy(_satVelocity).normalize();
            } else if (_satForward.lengthSq() < 0.1) {
                // Fallback: тангенс к надиру
                _satForward.crossVectors(_nadirToEarth, new THREE.Vector3(0, 1, 0)).normalize();
                if (_satForward.lengthSq() < 0.1) _satForward.set(1, 0, 0);
            }

            // Высота аппарата над сферой Земли
            const satAlt = Math.max(0.05, currentSatPos.length() - EARTH_RADIUS);

            // Смещаем камеру на 0.35 вперед по ходу полета и немного вниз по направлению к Земле.
            // Спутник остается сзади-сверху от камеры, исключая любое перекрытие обзора или артефакты полигонов.
            const forwardOffset = 0.35;
            const downOffset = Math.min(0.25, satAlt * 0.4);

            _nadirCamPos.copy(currentSatPos)
                .addScaledVector(_satForward, forwardOffset)
                .addScaledVector(_nadirToEarth, downOffset);

            // Гарантируем, что камера не приближается к Земле ближе допустимого безопасного порога
            const minCamR = EARTH_RADIUS + 0.05;
            if (_nadirCamPos.length() < minCamR) {
                _nadirCamPos.normalize().multiplyScalar(minCamR);
            }

            camera.position.copy(_nadirCamPos);
            camera.up.copy(_satForward); // верх кадра — по направлению полета
            camera.lookAt(0, 0, 0);      // камера направлена строго в центр Земли (надир)

            controls.target.copy(currentSatPos);
        } else {
            // --- СВОБОДНАЯ КАМЕРА: плавное слежение за спутником ---
            const deltaMove = currentSatPos.clone().sub(prevSatPos);
            controls.target.add(deltaMove);
            camera.position.add(deltaMove);
        }

        // Обновляем орбитальный след
        updateTrailForSat(selectedSat);

        // Обновляем 3D-конус и сферический купол покрытия на Земле
        updateCoverage(currentSatPos);

        // Координаты
        if (document.getElementById('sat-info-card').style.display === 'block') {
            const r = Math.sqrt(currentSatPos.x**2 + currentSatPos.y**2 + currentSatPos.z**2);
            let lat = Math.asin(currentSatPos.y / r) * (180 / Math.PI);
            let lon = (Math.atan2(currentSatPos.x, currentSatPos.z) * (180 / Math.PI)) - (sphere.rotation.y * (180 / Math.PI));

            lon = lon % 360;
            if (lon > 180) lon -= 360;
            if (lon < -180) lon += 360;

            const latStr = Math.abs(lat).toFixed(2) + '° ' + (lat >= 0 ? 'С.Ш.' : 'Ю.Ш.');
            const lonStr = Math.abs(lon).toFixed(2) + '° ' + (lon >= 0 ? 'В.Д.' : 'З.Д.');

            const latEl = document.getElementById('ui-lat');
            const lonEl = document.getElementById('ui-lon');
            if (latEl && lonEl) {
                latEl.innerText = latStr;
                lonEl.innerText = lonStr;
            }

            // Обновляем динамический статус раз в секунду
            if (frameCounter % 60 === 0) {
                const dynEl = document.getElementById('dyn-status');
                if (dynEl) {
                    dynEl.innerHTML = getDynamicStatus(selectedSat);
                }
            }
        }
    } else if (selectedSat && !selectedSat.mesh.visible) {
        clearTrail();
        removeCoverage();
    }

    controls.update();
    renderer.render(scene, camera);
}

animate();