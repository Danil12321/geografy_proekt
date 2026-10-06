import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ==========================================
// 1. СЦЕНА, КАМЕРА И РЕНДЕРЕР
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 4, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 2.2;
controls.maxDistance = 200;

// ==========================================
// 2. ИНТЕРФЕЙС (UI-карточка информации о спутнике)
// ==========================================
const infoCard = document.createElement('div');
infoCard.id = 'sat-info-card';
infoCard.style.cssText = `
    position: absolute;
    top: 20px;
    right: 20px;
    width: 310px;
    background: rgba(10, 15, 30, 0.88);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(0, 240, 255, 0.5);
    border-radius: 12px;
    padding: 16px;
    color: #ffffff;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    box-shadow: 0 0 25px rgba(0, 240, 255, 0.25);
    display: none;
    pointer-events: none;
    z-index: 1000;
    line-height: 1.45;
`;
document.body.appendChild(infoCard);

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
const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: true });
const stars = new THREE.Points(starsGeometry, starsMaterial);
scene.add(stars);

// ==========================================
// 4. ОСВЕЩЕНИЕ И СВЕЧЕНИЕ (Солнце и Луна)
// ==========================================
const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
sunLight.position.set(30, 15, 30);
scene.add(sunLight);

const moonLight = new THREE.DirectionalLight(0xaaccff, 0.8);
moonLight.position.set(-30, -15, -30);
scene.add(moonLight);

function createGlowTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
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
const sunGeometry = new THREE.SphereGeometry(15, 64, 64);
const sunMaterial = new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load('sun.jpg') });
const sun = new THREE.Mesh(sunGeometry, sunMaterial);
sun.position.set(170, 85, 170);
scene.add(sun);

const sunGlowMaterial = new THREE.SpriteMaterial({
    map: createGlowTexture({ r: 255, g: 200, b: 80 }),
    transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false
});
const sunGlow = new THREE.Sprite(sunGlowMaterial);
sunGlow.scale.set(80, 80, 1);
sunGlow.position.copy(sun.position);
scene.add(sunGlow);

// ЛУНА
const moonGeometry = new THREE.SphereGeometry(0.41, 32, 32);
const moonMaterial = new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load('moon.jpg'),
    roughness: 0.8, metalness: 0.1
});
const moon = new THREE.Mesh(moonGeometry, moonMaterial);
moon.position.set(-10, -4.5, -10);
scene.add(moon);

const moonGlowMaterial = new THREE.SpriteMaterial({
    map: createGlowTexture({ r: 170, g: 200, b: 255 }),
    transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false
});
const moonGlow = new THREE.Sprite(moonGlowMaterial);
moonGlow.scale.set(4, 4, 1);
moonGlow.position.copy(moon.position);
scene.add(moonGlow);

// ==========================================
// 5. ЗЕМЛЯ И ОБЛАКА
// ==========================================
const EARTH_RADIUS = 1.5;

const dayTexture = new THREE.TextureLoader().load('earth_day.jpg');
const nightTexture = new THREE.TextureLoader().load('earth_night.jpg');

const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
        dayTexture: { value: dayTexture },
        nightTexture: { value: nightTexture },
        sunDirection: { value: new THREE.Vector3(30, 15, 30).normalize() }
    },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
            vUv = uv;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D dayTexture;
        uniform sampler2D nightTexture;
        uniform vec3 sunDirection;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        
        void main() {
            float intensity = dot(vWorldNormal, sunDirection);
            vec4 dayColor = texture2D(dayTexture, vUv);
            vec4 nightColor = texture2D(nightTexture, vUv);
            float mixAmount = smoothstep(-0.25, 0.18, intensity);
            gl_FragColor = mix(nightColor, dayColor, mixAmount);
        }
    `
});

const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
const sphere = new THREE.Mesh(geometry, earthMaterial);
scene.add(sphere);

const cloudsGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 64, 64);
const cloudsMaterial = new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load('earth_clouds.jpg'),
    transparent: true, opacity: 0.4, depthWrite: false
});
const cloudsSphere = new THREE.Mesh(cloudsGeometry, cloudsMaterial);
scene.add(cloudsSphere);

// ==========================================
// 6. СПУТНИКОВЫЕ СИСТЕМЫ И ОРБИТЫ
// ==========================================
const satelliteObjects = []; // Массив для Raycaster и анимаций

function createSatelliteMesh(colorHex) {
    const group = new THREE.Group();
    // Корпус
    const bodyGeo = new THREE.BoxGeometry(0.06, 0.06, 0.08);
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.8, roughness: 0.2 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Солнечные панели
    const panelGeo = new THREE.BoxGeometry(0.24, 0.01, 0.05);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x002288, metalness: 0.9, roughness: 0.1 });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    group.add(panel);

    return group;
}

function createOrbitLine(radius, colorHex) {
    const points = [];
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(radius * Math.cos(theta), 0, radius * Math.sin(theta)));
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(points);
    const orbitMat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.35 });
    return new THREE.LineLoop(orbitGeo, orbitMat);
}

function addSatelliteConstellation({ name, count, planes, radius, inclination, speed, color, info }) {
    const satsPerPlane = Math.ceil(count / planes);

    for (let p = 0; p < planes; p++) {
        const planeAngle = (p / planes) * Math.PI * 2;

        const planeGroup = new THREE.Group();
        planeGroup.rotation.y = planeAngle;
        planeGroup.rotation.x = inclination;
        scene.add(planeGroup);

        const orbitLine = createOrbitLine(radius, color);
        planeGroup.add(orbitLine);

        for (let s = 0; s < satsPerPlane; s++) {
            const initialAngle = (s / satsPerPlane) * Math.PI * 2 + (p * 0.3);
            const satMesh = createSatelliteMesh(color);

            // Изначально выставляем стартовую позицию
            satMesh.position.x = radius * Math.cos(initialAngle);
            satMesh.position.z = radius * Math.sin(initialAngle);
            satMesh.rotation.y = -initialAngle;

            if (info.isRemoteSensing) {
                const beamHeight = radius - EARTH_RADIUS;
                const beamGeo = new THREE.ConeGeometry(0.3, beamHeight, 16, 1, true);
                const beamMat = new THREE.MeshBasicMaterial({
                    color: 0xffff00, transparent: true, opacity: 0.18, side: THREE.DoubleSide
                });
                const scanBeam = new THREE.Mesh(beamGeo, beamMat);
                scanBeam.rotation.x = Math.PI / 2;
                scanBeam.position.z = -beamHeight / 2;
                satMesh.add(scanBeam);
            }

            planeGroup.add(satMesh);

            satelliteObjects.push({
                mesh: satMesh,
                planeGroup: planeGroup,
                radius: radius,
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

// 6.1. GPS (США) — Скорость замедлена до 0.0008
addSatelliteConstellation({
    name: 'GPS IIF/III',
    count: 24,
    planes: 6,
    radius: EARTH_RADIUS * 3.8,
    inclination: THREE.MathUtils.degToRad(55),
    speed: 0.0008,
    color: 0x00f0ff,
    info: {
        system: 'GPS (NAVSTAR, США)',
        altitude: '~20 200 км (MEO)',
        type: 'Спутниковая навигация',
        purpose: 'Передача точных сигналов времени и координат для трехмерной навигации на Земле.',
        isRemoteSensing: false
    }
});

// 6.2. ГЛОНАСС (Россия) — Скорость замедлена до 0.0009
addSatelliteConstellation({
    name: 'ГЛОНАСС-К',
    count: 24,
    planes: 3,
    radius: EARTH_RADIUS * 3.6,
    inclination: THREE.MathUtils.degToRad(64.8),
    speed: 0.0009,
    color: 0x00ff66,
    info: {
        system: 'ГЛОНАСС (Россия)',
        altitude: '~19 100 км (MEO)',
        type: 'Спутниковая навигация',
        purpose: 'Глобальное навигационное обеспечение, высокоточная геодезия и топография.',
        isRemoteSensing: false
    }
});

// 6.3. ДЗЗ — Скорость замедлена до 0.002
addSatelliteConstellation({
    name: 'Sentinel-2A / Landsat-9',
    count: 6,
    planes: 3,
    radius: EARTH_RADIUS * 1.25,
    inclination: THREE.MathUtils.degToRad(98),
    speed: 0.002,
    color: 0xffd700,
    info: {
        system: 'Copernicus / USGS (Европа / США)',
        altitude: '~705 - 786 км (Полярная LEO)',
        type: 'Дистанционное зондирование Земли (ДЗЗ)',
        purpose: 'Оптико-электронная съемка суши и океанов, картографирование, анализ вырубки лесов и таяния ледников.',
        isRemoteSensing: true
    }
});

// 6.4. ГЕОСТАЦИОНАРНЫЕ — Скорость замедлена до 0.0004
addSatelliteConstellation({
    name: 'Электро-Л / GOES',
    count: 4,
    planes: 1,
    radius: EARTH_RADIUS * 5.2,
    inclination: 0,
    speed: 0.0004,
    color: 0xff00ff,
    info: {
        system: 'Геостационарная метеосеть',
        altitude: '~35 786 км (GEO)',
        type: 'Метеорологический и климатический мониторинг',
        purpose: 'Непрерывное наблюдение циркуляции атмосферы, штормов и глобального теплового баланса.',
        isRemoteSensing: false
    }
});

// 6.5. МКС — Скорость замедлена до 0.0025
addSatelliteConstellation({
    name: 'МКС (ISS)',
    count: 1,
    planes: 1,
    radius: EARTH_RADIUS * 1.15,
    inclination: THREE.MathUtils.degToRad(51.6),
    speed: 0.0025,
    color: 0xff8800,
    info: {
        system: 'Пилотируемая космическая станция',
        altitude: '~420 км (LEO)',
        type: 'Научно-исследовательская лаборатория',
        purpose: 'Аэрокосмические эксперименты, экологический мониторинг и визуальные географические наблюдения.',
        isRemoteSensing: false
    }
});

// ==========================================
// 7. ИНТЕРАКТИВНОСТЬ И НАВЕДЕНИЕ МЫШИ
// ==========================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredSat = null;

window.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const satMeshes = satelliteObjects.map(s => s.mesh);
    const intersects = raycaster.intersectObjects(satMeshes, true);

    if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj.parent && !satelliteObjects.find(s => s.mesh === obj)) {
            obj = obj.parent;
        }
        const foundSat = satelliteObjects.find(s => s.mesh === obj);

        if (foundSat) {
            document.body.style.cursor = 'pointer';

            if (hoveredSat !== foundSat) {
                if (hoveredSat) hoveredSat.mesh.scale.set(1, 1, 1);
                hoveredSat = foundSat;
                hoveredSat.mesh.scale.set(2.2, 2.2, 2.2);

                const i = foundSat.info;
                infoCard.style.display = 'block';
                infoCard.innerHTML = `
                    <div style="color: #${foundSat.colorHex.toString(16)}; font-size: 16px; font-weight: bold; margin-bottom: 6px;">
                        ${i.fullName}
                    </div>
                    <div style="font-size: 12px; color: #a0c0d0; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 6px;">
                        <b>Система:</b> ${i.system}
                    </div>
                    <div style="margin-bottom: 4px;"><b>Высота орбит:</b> ${i.altitude}</div>
                    <div style="margin-bottom: 8px;"><b>Тип:</b> ${i.type}</div>
                    <div style="font-size: 12px; color: #d0e8f5; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">
                        ${i.purpose}
                    </div>
                `;
            }
        }
    } else {
        document.body.style.cursor = 'default';
        if (hoveredSat) {
            hoveredSat.mesh.scale.set(1, 1, 1);
            hoveredSat = null;
        }
        infoCard.style.display = 'none';
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// 8. ЦИКЛ АНИМАЦИИ
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    // Вращение Земли и облаков продолжается всегда
    sphere.rotation.y += 0.0012;
    cloudsSphere.rotation.y += 0.0015;

    // Спутники двигаются ТОЛЬКО тогда, когда курсор НЕ наведен ни на один из них
    if (!hoveredSat) {
        satelliteObjects.forEach(sat => {
            sat.angle += sat.speed;
            sat.mesh.position.x = sat.radius * Math.cos(sat.angle);
            sat.mesh.position.z = sat.radius * Math.sin(sat.angle);
            sat.mesh.rotation.y = -sat.angle;
        });
    }

    controls.update();
    renderer.render(scene, camera);
}

animate();