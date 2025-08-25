export const System_prompt = `You are a Three.js code-generation assistant.
Strict OUTPUT RULES:
- Output ONLY JavaScript code. No backticks, no markdown, no commentary.
- Export a default function:
  export default function renderScene({ THREE, scene, camera, renderer, controls, OrbitControls }) { ... }
- THREE, scene, camera, renderer, controls, and OrbitControls are available as parameters.
- OrbitControls is passed as a separate parameter, not as THREE.OrbitControls.
- Clear previous objects at the start (dispose geometries/materials where relevant).
- Add basic lighting and frame the subject for visibility.
- Use primitives or programmatic geometry; no network fetches.
- If you need OrbitControls, use: new OrbitControls(camera, renderer.domElement)
- Keep it concise and readable; add minimal comments.
- Keep triangle count modest unless asked otherwise.
- Do not create duplicate lights if they already exist in the scene.
- Generate ONLY the 3D object itself - NO ground plane, NO base, NO floor, NO platform beneath the object.
- DO NOT add PlaneGeometry, ground meshes, or any flat surfaces as bases.
- Focus solely on creating the requested 3D geometry floating in space.
- The scene already has a grid helper for reference - do not add additional ground elements.
-Always align objects so their base sits at or just above y=0 by adjusting position.y using the bounding box or geometry dimensions.`;

export const FRAME_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>html,body{margin:0;height:100%;overflow:hidden;background:#f8f9fa}</style>
</head>
<body>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@latest/build/three.module.js","three/":"https://unpkg.com/three@latest/"}}</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "https://unpkg.com/three@latest/examples/jsm/controls/OrbitControls.js";
import { OBJExporter } from "https://unpkg.com/three@latest/examples/jsm/exporters/OBJExporter.js";
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.setClearColor(0xf8f9fa);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
camera.position.set(8, 8, 8);
controls.target.set(0, 0, 0);
controls.saveState();
const light = new THREE.DirectionalLight(0xffffff, 0.8);
light.position.set(10, 10, 5);
light.castShadow = true;
light.shadow.mapSize.setScalar(2048);
const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
// Create grid with specific properties to ensure visibility
const grid = new THREE.GridHelper(20, 20, 0x888888, 0xcccccc);
grid.userData = { isPermanent: true };
grid.renderOrder = -1; // Render grid first
grid.material.transparent = true;
grid.material.opacity = 0.8;
grid.position.y = 0; // Ensure it's at ground level
scene.add(ambientLight, light, grid);
let autoRotate = false, wireframe = false;
const userObjects = new Set();
const originalAdd = scene.add;
const permanentObjects = new Set([ambientLight, light, grid]);
scene.add = function(...objects) {
  objects.forEach(obj => {
    if (!permanentObjects.has(obj) && !obj.userData?.isPermanent) {
      userObjects.add(obj);
      console.log('Added user object:', obj.type, obj.geometry?.type);
    }
  });
  return originalAdd.apply(this, arguments);
};
const arrayBufferToBase64 = (buffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};
const getExportableObjects = () => {
  const exportGroup = new THREE.Group();
  userObjects.forEach(obj => {
    if (obj.geometry && obj.parent === scene) {
      exportGroup.add(obj.clone());
    } else if (obj.children && obj.children.length > 0) {
      obj.traverse(child => {
        if (child.geometry && child !== obj) {
          exportGroup.add(child.clone());
        }
      });
    }
  });
  return exportGroup;
};
const ensureGridVisible = () => {
  const gridsToRemove = [];
  scene.traverse(child => {
    if (child.type === 'GridHelper' && !child.userData?.isPermanent) {
      gridsToRemove.push(child);
    }
  });
  gridsToRemove.forEach(g => scene.remove(g));
  if (!scene.children.includes(grid)) { scene.add(grid);}
  grid.visible = true;
  grid.position.y = 0;
  grid.renderOrder = -1;
  grid.material.transparent = true;
  grid.material.opacity = 0.8;
};
const calculateAndUpdateSize = () => {
  if (userObjects.size === 0) {
    parent.postMessage({ type: 'SIZE_UPDATE', x: 0, y: 0, z: 0 }, '*');
    return;
  }
  const box = new THREE.Box3();
  userObjects.forEach(obj => {
    const objBox = new THREE.Box3().setFromObject(obj);
    box.union(objBox);
  });
  const size = box.getSize(new THREE.Vector3());
  parent.postMessage({ 
    type: 'SIZE_UPDATE', 
    x: size.x, 
    y: size.y, 
    z: size.z 
  }, '*');
};
(function animate() {
  requestAnimationFrame(animate);
  if (autoRotate) scene.rotation.y += 0.01;
  controls.update();
  renderer.render(scene, camera);
  calculateAndUpdateSize();
})();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
const clearScene = () => {
  userObjects.forEach(obj => {
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(m => {
        if (m && m.dispose) m.dispose();
      });
    }
  });
  userObjects.clear();
  ensureGridVisible();
  console.log('Scene cleared, user objects:', userObjects.size);
};
addEventListener('message', async e => {
  const { type, code, value } = e.data;
  if (type === 'RUN_CODE') {
    try {
      clearScene();
      if (code && code.trim()) {
        const moduleCode = \`import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
\${code}\`;
        const url = URL.createObjectURL(new Blob([moduleCode], { type: 'text/javascript' }));
        try {
          const module = await import(url);
          if (typeof module.default !== 'function') {
            throw new Error('Module does not export a default function');
          }
          await module.default({ THREE, scene, camera, renderer, controls, OrbitControls });
          ensureGridVisible();
          controls.reset();
          setTimeout(() => {
            const objectCount = userObjects.size;
            console.log('Code executed, user objects created:', objectCount);
            parent.postMessage({ type: 'OBJECTS_READY', count: objectCount }, '*');
            calculateAndUpdateSize();
          }, 300);        
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      parent.postMessage({ type: 'DONE' }, '*');
    } catch (error) {
      console.error('Code execution error:', error);
      parent.postMessage({ type: 'ERROR', message: error.message }, '*');
    }
  }
  else if (type === 'EXPORT_OBJ') {
    try {
      const exportGroup = getExportableObjects();     
      if (exportGroup.children.length === 0) {
        parent.postMessage({ type: 'ERROR', message: 'No objects to export. Make sure you have generated a 3D scene first.' }, '*');
        return;
      }      
      const exporter = new OBJExporter();
      const result = exporter.parse(exportGroup);    
      parent.postMessage({
        type: 'DOWNLOAD',
        data: result,
        filename: 'model.obj',
        mimeType: 'text/plain',
        binary: false
      }, '*');
    } catch (error) {
      console.error('OBJ Export Error:', error);
      parent.postMessage({ type: 'ERROR', message: 'OBJ export failed: ' + error.message }, '*');
    }
  }
  else if (type === 'GET_SCREENSHOT') {
    try {
      renderer.render(scene, camera);
      parent.postMessage({ type: 'SCREENSHOT', dataUrl: renderer.domElement.toDataURL('image/png', 0.9) }, '*');
    } catch (error) {
      parent.postMessage({ type: 'ERROR', message: 'Screenshot failed: ' + error.message }, '*');
    }
  }
  else if (type === 'RESET_CAMERA') {
    controls.reset();
  }
  else if (type === 'TOGGLE_AUTO_ROTATE') {
    autoRotate = value;
  }
  else if (type === 'TOGGLE_WIREFRAME') {
    wireframe = value;
    userObjects.forEach(obj => {
      obj.traverse(child => {
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach(m => m.wireframe = wireframe);
        }
      });
    });
  }
});
ensureGridVisible();
parent.postMessage({ type: 'READY' }, '*');
</script>
</body>
</html>`;