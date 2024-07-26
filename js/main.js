import * as THREE from 'https://cdn.skypack.dev/three@0.128.0';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import { geoInterpolate } from 'https://cdn.skypack.dev/d3-geo@3.1.1';

console.log('Script loaded');

const DOT_COUNT = 60000;

// Create scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 0, 1200);

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);
document.getElementById('globe-container').appendChild(renderer.domElement);

console.log('Renderer created and attached to DOM');

const light = new THREE.AmbientLight(0xffffff);
scene.add(light);
console.log('Light added to scene');

// Create globe container
const globeContainer = new THREE.Object3D();
scene.add(globeContainer);
console.log('Globe container added to scene');

// Create base globe with the specified color
const baseGlobeGeometry = new THREE.SphereGeometry(600, 64, 64);
const baseGlobeMaterial = new THREE.MeshBasicMaterial({ color: 0x0e284b });
const baseGlobe = new THREE.Mesh(baseGlobeGeometry, baseGlobeMaterial);
globeContainer.add(baseGlobe);
console.log('Base globe added to scene');

// Function to get image data
function getImageData(image) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = image.width;
  canvas.height = image.height;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

// Function to convert 3D point to UV coordinates
function pointToUV(center, position) {
  const direction = new THREE.Vector3().subVectors(position, center).normalize();
  const u = 0.5 + (Math.atan2(direction.z, direction.x) / (2 * Math.PI));
  const v = 0.5 - (Math.asin(direction.y) / Math.PI);
  return { u, v };
}

// Function to sample image data at given UV coordinates
function sampleImage({ u, v }, imageData) {
  const x = Math.floor(u * imageData.width);
  const y = Math.floor(v * imageData.height);
  const index = (y * imageData.width + x) * 4;
  return [
    imageData.data[index],
    imageData.data[index + 1],
    imageData.data[index + 2],
    imageData.data[index + 3]
  ];
}

// Load the map image and create dots
let imageData;
new THREE.ImageLoader().load('../images/map.png', (mapImage) => {
  console.log('Image loaded', mapImage);
  imageData = getImageData(mapImage);

  const dotGeometry = new THREE.BufferGeometry();
  const positions = [];
  const vector = new THREE.Vector3();

  for (let i = 0; i < DOT_COUNT; i++) {
    const phi = Math.acos(-1 + (2 * i) / DOT_COUNT);
    const theta = Math.sqrt(DOT_COUNT * Math.PI) * phi;

    vector.setFromSphericalCoords(600, phi, theta);

    const uv = pointToUV(new THREE.Vector3(0, 0, 0), vector);
    const sample = sampleImage(uv, imageData);

    if (sample[3] > 0) {
      positions.push(vector.x, vector.y, vector.z);
    }
  }

  dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  dotGeometry.computeBoundingSphere();

  const dotMaterial = new THREE.PointsMaterial({ color: 0x2c649b, size: 3 });
  const dots = new THREE.Points(dotGeometry, dotMaterial);
  globeContainer.add(dots);
  console.log('Dots added to globe container');
});


function isLandPoint(lat, lon) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const vector = new THREE.Vector3();
  vector.setFromSphericalCoords(600, phi, theta);
  const uv = pointToUV(new THREE.Vector3(0, 0, 0), vector);
  const sample = sampleImage(uv, imageData);
  return sample[3] > 0;
}

// Arc class
class Arc extends THREE.Object3D {
  constructor(start, end, radius) {
    super();

    const startXYZ = toXYZ(start[0], start[1], radius);
    const endXYZ = toXYZ(end[0], end[1], radius);

    const d3Interpolate = geoInterpolate(
      [start[1], start[0]],
      [end[1], end[0]],
    );
    const control1 = d3Interpolate(0.25);
    const control2 = d3Interpolate(0.75);

    const arcHeight = startXYZ.distanceTo(endXYZ) * 0.3 + radius;
    const controlXYZ1 = toXYZ(control1[1], control1[0], arcHeight);
    const controlXYZ2 = toXYZ(control2[1], control2[0], arcHeight);

    const curve = new THREE.CubicBezierCurve3(startXYZ, controlXYZ1, controlXYZ2, endXYZ);

    this.geometry = new THREE.TubeBufferGeometry(curve, 44, 2, 8);

    const startColor = getRandomColor();
    const endColor = getRandomColor();

    const colors = [];
    for (let i = 0; i < this.geometry.attributes.position.count; i++) {
      const color = startColor.clone().lerp(endColor, i / (this.geometry.attributes.position.count - 1));
      colors.push(color.r, color.g, color.b);
    }
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    this.material = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vColor;
        void main() {
          vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
      vertexColors: true,
      transparent: true,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.add(this.mesh);

    this.geometry.setDrawRange(0, 1);
    this.startTime = performance.now();
    this.drawAnimatedLine();
    setTimeout(() => this.startRemovingArc(), 5000);

    this.circleMesh = this.createCircleMesh();
    this.circleMesh.visible = false;
    this.add(this.circleMesh);
    this.endXYZ = endXYZ;
  }

  drawAnimatedLine = () => {
    let drawRangeCount = this.geometry.drawRange.count;
    const timeElapsed = performance.now() - this.startTime;

    const progress = timeElapsed / 2500;

    drawRangeCount = progress * 3000;

    if (progress < 0.999) {
      this.geometry.setDrawRange(0, drawRangeCount);
      requestAnimationFrame(this.drawAnimatedLine);
    } else {
      this.startTime = performance.now();
      this.animateCircle();
    }
  }

  startRemovingArc = () => {
    this.removeArcSmoothly();
  }

  removeArcSmoothly = () => {
    const totalVertices = this.geometry.drawRange.count;
    const step = totalVertices / 100;
    const interval = setInterval(() => {
      if (this.geometry.drawRange.count > 0) {
        this.geometry.setDrawRange(0, this.geometry.drawRange.count - step);
      } else {
        clearInterval(interval);
        this.parent.remove(this);
      }
    }, 20);
  }

  createCircleMesh = () => {
    const innerCircleGeometry = new THREE.CircleGeometry(5, 32);
    const outerCircleGeometry = new THREE.RingGeometry(6, 12, 32);
    const innerCircleMaterial = new THREE.MeshBasicMaterial({ color: getRandomColor(), side: THREE.DoubleSide });
    const outerCircleMaterial = new THREE.MeshBasicMaterial({ color: getRandomColor(), side: THREE.DoubleSide, transparent: true, opacity: 1 });

    const innerCircleMesh = new THREE.Mesh(innerCircleGeometry, innerCircleMaterial);
    const outerCircleMesh = new THREE.Mesh(outerCircleGeometry, outerCircleMaterial);

    const circleGroup = new THREE.Group();
    circleGroup.add(innerCircleMesh);
    circleGroup.add(outerCircleMesh);

    return circleGroup;
  }

  animateCircle = () => {
    this.circleMesh.position.copy(this.endXYZ);
    this.circleMesh.lookAt(new THREE.Vector3(0, 0, 0));
    this.circleMesh.scale.set(0.5, 0.5, 0.5);
    this.circleMesh.visible = true;

    const duration = 500;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const scale = 0.1 + 0.9 * progress;
      this.circleMesh.scale.set(scale, scale, scale);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }
}

// Function to generate a random color
function getRandomColor() {
  return new THREE.Color(Math.random(), Math.random(), Math.random());
}

// Function to convert lat/lon to XYZ
function toXYZ(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);

  const x = -((radius) * Math.sin(phi) * Math.cos(theta));
  const z = ((radius) * Math.sin(phi) * Math.sin(theta));
  const y = ((radius) * Math.cos(phi));

  return new THREE.Vector3(x, y, z);
}

function createAndAddArcs(numArcs) {
  for (let i = 0; i < numArcs; i++) {
    const delay = Math.random() * 15000;
    setTimeout(() => {
      let startPoint, endPoint;
      do {
        startPoint = [Math.random() * 180 - 90, Math.random() * 360 - 180];
        endPoint = [Math.random() * 180 - 90, Math.random() * 360 - 180];
      } while (!isLandPoint(startPoint[0], startPoint[1]) || !isLandPoint(endPoint[0], endPoint[1]));

      const arc = new Arc(startPoint, endPoint, 600);
      globeContainer.add(arc);
      console.log('New arc added to globe container');
    }, delay);
  }
}

// Create the first set of arcs
createAndAddArcs(10);
setInterval(() => createAndAddArcs(15), 10000);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.update();

let mouseX = 0;
let mouseY = 0;
let isMouseOverGlobe = false;

// Add event listener for mouse move over the globe
const globeElement = document.getElementById('globe-container');

globeElement.addEventListener('mousemove', (event) => {
  const rect = globeElement.getBoundingClientRect();
  if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
    isMouseOverGlobe = true;
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
  } else {
    isMouseOverGlobe = false;
  }
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  if (isMouseOverGlobe) {
    globeContainer.rotation.y += mouseX * 0.002;
    globeContainer.rotation.x += mouseY * 0.002;
  } else {
    globeContainer.rotation.y += 0.001;
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
console.log('Animation started');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
