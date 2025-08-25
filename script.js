import { System_prompt, FRAME_TEMPLATE } from "./utils.js";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2";
import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1.2";
import { bootstrapAlert } from "https://cdn.jsdelivr.net/npm/bootstrap-alert@1";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";

const $ = id => document.getElementById(id);
const marked = new Marked();
marked.use({
  renderer: {
    code(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "javascript";
      return `<pre class="hljs language-${language}"><code>${hljs.highlight(code, { language })
        .value.trim()}</code></pre>`;
    },
  },
});

const S = {
  provider: null,
  models: [],
  currentModel: null,
  sourceCode: "",
  frame: null,
  frameReady: false,
  pendingCode: null,
  session: []
};
const controls = {
  autoRotate: false,
  wireframe: false
};
let referenceImageDataUrl = null;
const SYSTEM_PROMPT = System_prompt;
const stripFences = s => s.replace(/^```(?:js|javascript)?\s*/i, "").replace(/```$/i, "");
const alertBox = (type, message) => {
  bootstrapAlert({
    body: message,
    color: type,
    position: 'top-0 end-0',
    delay: type === 'success' ? 3000 : 5000
  });
};

const showLoading = show => $('loading').classList.toggle('d-none', !show);
async function initLlm(show = false) {
  try {
    const config = await openaiConfig({
      title: "LLM Configuration for 3D Generator",
      defaultBaseUrls: [
        "https://api.openai.com/v1",
        "https://openrouter.ai/api/v1",
        "https://api.anthropic.com/v1"
      ],
      show
    });
    S.provider = { baseUrl: config.baseUrl, apiKey: config.apiKey, models: config.models };
    const filteredModels = config.models.filter(model => {
      const modelName = model.toLowerCase();
      return modelName.includes('gpt-4.1') || modelName.includes('gpt-5');
    });
    S.models = filteredModels.map(model => ({ id: model, name: model }));
    S.currentModel = S.models.find(m => m.id.toLowerCase().includes('gpt-4.1'))?.id || 
                     S.models.find(m => m.id.toLowerCase().includes('gpt-5'))?.id ||
                     S.models[0]?.id;
        fillModelDropdown();
      alertBox('success', `LLM configured successfully `);
  } catch (error) {
    alertBox('danger', `Failed to initialize LLM: ${error.message}`);
  }
}

function fillModelDropdown() {
  const select = $('model-select');
  select.replaceChildren(...S.models.map(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    option.selected = model.id === S.currentModel;
    return option;
  }));
}

async function llmGenerate({ promptText, priorCode, screenshotDataUrl }) {
  if (!S.provider) throw new Error('LLM not configured. Please click Config button.');
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if (priorCode && screenshotDataUrl) {
    const content = [
      {
        type: "text",
        text: `Task: Modify the existing Three.js scene per: "${promptText}"\n\nCurrent code:\n${priorCode}\n\nA screenshot of the current render is attached. Please update the code so that the 3D object matches the appearance shown in the reference image, ensuring the rendered output looks the same as the reference. IMPORTANT: Do not add any ground plane, base, or floor - only modify the 3D object itself.`
      },
      { type: "image_url", image_url: { url: screenshotDataUrl } }
    ];    
    if (referenceImageDataUrl) {
      content.push(
        {
          type: "text",
          text: "Additionally, a reference image is provided to guide the modifications. Focus only on the main object, not any ground or base elements."
        },
        {
          type: "image_url", image_url: { url: referenceImageDataUrl }
        }
      );
    }
    messages.push({ role: "user", content });
  } else {
    const content = [
      {
        type: "text",
        text: `Task: Create a 3D scene per: "${promptText}"\nConstraints:\n- No imports; the runtime provides THREE, OrbitControls as parameters.\n- Add reasonable lights and camera framing of subject.\n- Use new OrbitControls(camera, renderer.domElement) if needed.\n- Return ONLY code for export default function renderScene({ THREE, scene, camera, renderer, controls, OrbitControls }) { ... }.\n- CRITICAL: Do NOT create any ground plane, base, floor, or platform. Create ONLY the requested 3D object floating in space.\n- The scene already has a grid for reference - do not add PlaneGeometry or ground meshes.`
      }
    ];
    if (referenceImageDataUrl) {
      content.push({ type: "image_url", image_url: { url: referenceImageDataUrl } });
      content[0].text += "\n\nA reference image is provided to guide the 3D object creation. Focus only on the main object, ignoring any ground or base elements in the reference.";
    }
    messages.push({ role: "user", content });
  }
  const requestOptions = {
    method: "POST",
    headers: {  "Content-Type": "application/json","Authorization": `Bearer ${S.provider.apiKey}`},
    body: JSON.stringify({ model: S.currentModel, messages, stream: true })
  };
  let fullContent = "";
  const codeView = $('code-view');
  try {
    for await (const data of asyncLLM(S.provider.baseUrl + "/chat/completions", requestOptions)) {
      if (data.content) {
        fullContent = data.content;
        const highlighted = marked.parse(`\`\`\`javascript\n${stripFences(fullContent)}\n\`\`\``);
        codeView.innerHTML = highlighted;
      }
    }
  } catch (error) {
    console.error('Streaming error:', error);
    throw error;
  }
  return stripFences(fullContent).trim();
}

const displayScreenshot = (dataUrl) => {
  const screenshotCard = $('screenshot-card');
  const screenshotImg = $('screenshot-img');
  if (dataUrl) {
    screenshotImg.src = dataUrl;
    screenshotCard.classList.remove('d-none');
  } else {   screenshotCard.classList.add('d-none');  }
};

const setupImageUpload = () => {
  const fileInput = $('reference-image');
  const preview = $('image-preview');
  const previewImg = $('preview-img');
  const removeBtn = $('remove-image');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        referenceImageDataUrl = e.target.result;
        previewImg.src = referenceImageDataUrl;
        preview.classList.remove('d-none');
      };
      reader.readAsDataURL(file);
    }
  });
  removeBtn.addEventListener('click', () => {
    referenceImageDataUrl = null;
    fileInput.value = '';
    preview.classList.add('d-none');
  });
};

const exportOBJ = () => { S.frame.contentWindow.postMessage({ type: 'EXPORT_OBJ' }, '*'); };
const resetCamera = () => {  S.frame.contentWindow.postMessage({ type: 'RESET_CAMERA' }, '*'); };
const toggleAutoRotate = () => {
  controls.autoRotate = !controls.autoRotate;
  S.frame.contentWindow.postMessage({ type: 'TOGGLE_AUTO_ROTATE', value: controls.autoRotate }, '*');
  $('btn-auto-rotate').textContent = controls.autoRotate ? 'Stop Rotate' : 'Auto-Rotate';
};
const toggleWireframe = () => {
  controls.wireframe = !controls.wireframe;
  S.frame.contentWindow.postMessage({ type: 'TOGGLE_WIREFRAME', value: controls.wireframe }, '*');
  $('btn-wireframe').textContent = controls.wireframe ? 'Solid' : 'Wireframe';
};
const runInFrame = code => {
  if (!S.frameReady) { S.pendingCode = code;  return; }
  S.frame.contentWindow.postMessage({ type: 'RUN_CODE', code }, '*');
};

const getScreenshot = () => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    window.removeEventListener('message', handler);
    reject(new Error('Screenshot timeout'));
  }, 10000);
  const handler = e => {
    if (e.data.type === 'SCREENSHOT') {
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve(e.data.dataUrl);
    }
  };
  window.addEventListener('message', handler);
  S.frame.contentWindow.postMessage({ type: 'GET_SCREENSHOT' }, '*');
});

async function submit() {
  const promptText = $('user-prompt').value.trim();
  if (!promptText) {  alertBox('warning', 'Please enter a prompt');  return; }
  if (!S.provider) {  alertBox('danger', 'Please configure LLM first');  return;}
  S.currentModel = $('model-select').value;
  showLoading(true);
  $('btn-export-obj').disabled = true;
  try {
    let screenshotDataUrl = null;
    if (S.sourceCode) {
      try {
        screenshotDataUrl = await getScreenshot();
        displayScreenshot(screenshotDataUrl);
      } catch (error) {
        console.warn('Failed to capture screenshot:', error);
      }
    }
    const code = await llmGenerate({ promptText, priorCode: S.sourceCode, screenshotDataUrl });
    if (code) {
      S.sourceCode = code;
      runInFrame(code);
      S.session.push({prompt: promptText,code, screenshot: screenshotDataUrl, 
        referenceImage: referenceImageDataUrl,timestamp: Date.now() 
      });
      alertBox('success', 'Scene generated successfully');
    } else {  
      alertBox('warning', 'No code generated. Please try again.');  
    }
  } catch (error) {
    console.error('Generation error:', error);
    alertBox('danger', `Error: ${error.message}`);
  }
  showLoading(false);
}

const addEventListeners = () => {
  $('config-btn').addEventListener('click', () => initLlm(true));
  $('btn-generate').addEventListener('click', submit);
  $('user-prompt').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {  
      e.preventDefault();  
      submit(); 
    }
  });
  $('btn-reset-camera').addEventListener('click', resetCamera);
  $('btn-auto-rotate').addEventListener('click', toggleAutoRotate);
  $('btn-wireframe').addEventListener('click', toggleWireframe);
  $('btn-export-obj').addEventListener('click', exportOBJ);
  setupImageUpload();
};

const handleFrameMessages = e => {
  const { type, data, filename, mimeType, binary, count } = e.data;
  if (type === 'READY') {
    S.frameReady = true;
    if (S.pendingCode) { 
      runInFrame(S.pendingCode); 
      S.pendingCode = null; 
    }
  } else if (type === 'ERROR') {
    alertBox('danger', `Error: ${e.data.message}`);
  } else if (type === 'OBJECTS_READY') {
    const hasObjects = count > 0;
    $('btn-export-obj').disabled = !hasObjects;
    if (hasObjects) {  alertBox('success', `Scene ready for export (${count} objects)`); }
    else { alertBox('warning', 'No exportable objects found in the scene'); }
  } else if (type === 'SIZE_UPDATE') {
    const { x, y, z } = e.data;
    $('size-x').textContent = x.toFixed(2);
    $('size-y').textContent = y.toFixed(2);
    $('size-z').textContent = z.toFixed(2);
  } else if (type === 'DOWNLOAD') {
    try {
      let blob;
      if (binary) {
        const binaryString = window.atob(data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: mimeType });
      } else {
        blob = new Blob([data], { type: mimeType });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      alertBox('success', `${filename} downloaded successfully`);
    } catch (error) {
      console.error('Download error:', error);
      alertBox('danger', `Download failed: ${error.message}`);
    }
  }
};

const init = () => {
  S.frame = $('render-frame');
  S.frame.srcdoc = FRAME_TEMPLATE;
  addEventListeners();
  window.addEventListener('message', handleFrameMessages);
  initLlm().catch(() => console.log('LLM not configured yet, user will need to click config'));
};

init();