import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 1. Сцена
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// 2. Камера
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 6);

// 3. Рендерер
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 4. Управление камерой
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 3;
controls.maxDistance = 200;

// 5. Звёзды
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

// 6. СВЕТ
const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
sunLight.position.set(30, 15, 30);
scene.add(sunLight);

const moonLight = new THREE.DirectionalLight(0xaaccff, 0.8);
moonLight.position.set(-30, -15, -30);
scene.add(moonLight);

// 7. ФУНКЦИЯ ДЛЯ СОЗДАНИЯ СВЕЧЕНИЯ
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

// 8. СОЛНЦЕ
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

// 9. ЛУНА
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

// 10. ЗЕМЛЯ (день + ночь) — ИСПРАВЛЕНО
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

const geometry = new THREE.SphereGeometry(1.5, 64, 64);
const sphere = new THREE.Mesh(geometry, earthMaterial);
scene.add(sphere);

// 11. ОБЛАКА
const cloudsGeometry = new THREE.SphereGeometry(1.52, 64, 64);
const cloudsMaterial = new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load('earth_clouds.jpg'),
    transparent: true, opacity: 0.4, depthWrite: false
});
const cloudsSphere = new THREE.Mesh(cloudsGeometry, cloudsMaterial);
scene.add(cloudsSphere);

// 12. Анимация
function animate() {
    requestAnimationFrame(animate);
    sphere.rotation.y += 0.002;
    cloudsSphere.rotation.y += 0.0025;
    controls.update();
    renderer.render(scene, camera);
}
animate();