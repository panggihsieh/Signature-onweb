const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_DOC = {
  width: 900,
  height: 1200,
};

const state = {
  mode: "teacher",
  caseId: "",
  title: "",
  text: "",
  file: null,
  fields: [],
  signatures: {},
  selectedFieldId: "",
  sourceCanvas: document.createElement("canvas"),
};

const els = {
  teacherTab: document.querySelector("#teacherTab"),
  parentTab: document.querySelector("#parentTab"),
  teacherView: document.querySelector("#teacherView"),
  parentView: document.querySelector("#parentView"),
  fileInput: document.querySelector("#fileInput"),
  uploadStatus: document.querySelector("#uploadStatus"),
  caseStatus: document.querySelector("#caseStatus"),
  parentStatus: document.querySelector("#parentStatus"),
  teacherDoc: document.querySelector("#teacherDoc"),
  parentDoc: document.querySelector("#parentDoc"),
  teacherCanvas: document.querySelector("#teacherCanvas"),
  parentCanvas: document.querySelector("#parentCanvas"),
  fieldLayer: document.querySelector("#fieldLayer"),
  parentFieldLayer: document.querySelector("#parentFieldLayer"),
  addSignature: document.querySelector("#addSignature"),
  clearFields: document.querySelector("#clearFields"),
  generateLink: document.querySelector("#generateLink"),
  parentLink: document.querySelector("#parentLink"),
  copyLink: document.querySelector("#copyLink"),
  downloadTeacherImage: document.querySelector("#downloadTeacherImage"),
  downloadBlankPreview: document.querySelector("#downloadBlankPreview"),
  signatureSelect: document.querySelector("#signatureSelect"),
  signaturePad: document.querySelector("#signaturePad"),
  clearSignature: document.querySelector("#clearSignature"),
  applySignature: document.querySelector("#applySignature"),
  downloadParentImage: document.querySelector("#downloadParentImage"),
  completedImage: document.querySelector("#completedImage"),
};

const signatureContext = els.signaturePad.getContext("2d");
let drawing = false;

init();

async function init() {
  bindEvents();
  clearSignaturePad();

  const caseId = new URLSearchParams(location.search).get("case");
  if (caseId) {
    await loadParentCase(caseId);
    return;
  }

  drawEmptySource();
  addField();
  setMode("teacher");
}

function bindEvents() {
  els.teacherTab.addEventListener("click", () => setMode("teacher"));
  els.parentTab.addEventListener("click", () => setMode("parent"));
  els.fileInput.addEventListener("change", handleFile);
  els.addSignature.addEventListener("click", addField);
  els.clearFields.addEventListener("click", () => {
    state.fields = [];
    state.selectedFieldId = "";
    renderAll();
  });
  els.generateLink.addEventListener("click", generateParentLink);
  els.copyLink.addEventListener("click", copyParentLink);
  els.downloadTeacherImage.addEventListener("click", () => downloadDocument("blank"));
  els.downloadBlankPreview.addEventListener("click", () => downloadDocument("blank"));
  els.signatureSelect.addEventListener("change", () => {
    state.selectedFieldId = els.signatureSelect.value;
    renderParentFields();
  });
  els.clearSignature.addEventListener("click", clearSignaturePad);
  els.applySignature.addEventListener("click", applySignature);
  els.downloadParentImage.addEventListener("click", downloadSignedDocument);
  bindSignaturePad();
}

async function loadParentCase(caseId) {
  setStatus(els.parentStatus, "正在讀取同意書...", "");

  try {
    const response = await fetch(`/api/cases/${caseId}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "簽名連結無法使用。");

    state.caseId = payload.id;
    state.title = payload.title;
    state.text = payload.text || "";
    state.fields = payload.fields || [];
    state.selectedFieldId = state.fields[0]?.id || "";
    state.file = payload.file;

    await renderSourceFromState();
    setMode("parent");
    setStatus(els.parentStatus, `連結有效至 ${formatTime(payload.expiresAt)}`, "success");
  } catch (error) {
    setMode("parent");
    setStatus(els.parentStatus, error.message, "error");
  }
}

function setMode(mode) {
  state.mode = mode;
  const isTeacher = mode === "teacher";
  els.teacherTab.classList.toggle("active", isTeacher);
  els.parentTab.classList.toggle("active", !isTeacher);
  els.teacherView.classList.toggle("active", isTeacher);
  els.parentView.classList.toggle("active", !isTeacher);
  renderAll();
}

async function handleFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > MAX_UPLOAD_BYTES) {
    setStatus(els.uploadStatus, "檔案超過 5MB，請壓縮後再上傳。", "error");
    event.target.value = "";
    return;
  }

  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isImage && !isPdf) {
    setStatus(els.uploadStatus, "第一版僅支援圖片與 PDF。", "error");
    event.target.value = "";
    return;
  }

  setStatus(els.uploadStatus, "正在載入檔案...", "");
  const dataUrl = await readFileAsDataUrl(file);
    state.file = {
      name: file.name,
      type: isPdf ? "application/pdf" : file.type,
      size: file.size,
      dataUrl,
    };
    state.title = file.name.replace(/\.[^.]+$/, "") || "同意書";
    state.text = "";

  try {
    await renderSourceFromState();
    setStatus(els.uploadStatus, `${file.name} 已載入，大小 ${(file.size / 1024 / 1024).toFixed(2)}MB。`, "success");
  } catch (error) {
    state.file = null;
    drawEmptySource();
    setStatus(els.uploadStatus, error.message, "error");
  }

  renderAll();
}

async function renderSourceFromState() {
  if (!state.file) {
    drawEmptySource();
    return;
  }

  if (state.file.type === "application/pdf") {
    await drawPdfSource(state.file.dataUrl);
    return;
  }

  await drawImageSource(state.file.dataUrl);
}

async function drawImageSource(dataUrl) {
  const image = await loadImage(dataUrl);
  const maxWidth = 1200;
  const ratio = image.naturalHeight / image.naturalWidth;
  const width = Math.min(maxWidth, image.naturalWidth);
  const height = Math.round(width * ratio);
  setCanvasSize(state.sourceCanvas, width, height);
  state.sourceCanvas.getContext("2d").drawImage(image, 0, 0, width, height);
}

async function drawPdfSource(dataUrl) {
  if (!window.pdfjsLib) {
    const pdf = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
    window.pdfjsLib = pdf;
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const documentTask = window.pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) });
  const pdf = await documentTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.6 });
  setCanvasSize(state.sourceCanvas, Math.round(viewport.width), Math.round(viewport.height));
  await page.render({
    canvasContext: state.sourceCanvas.getContext("2d"),
    viewport,
  }).promise;
}

function drawEmptySource() {
  setCanvasSize(state.sourceCanvas, DEFAULT_DOC.width, DEFAULT_DOC.height);
  const ctx = state.sourceCanvas.getContext("2d");
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, DEFAULT_DOC.width, DEFAULT_DOC.height);
  ctx.fillStyle = "#14212b";
  ctx.textAlign = "center";
  ctx.font = "700 34px sans-serif";
  ctx.fillText("請先上傳圖片或 PDF 同意書", DEFAULT_DOC.width / 2, DEFAULT_DOC.height / 2 - 20);
  ctx.fillStyle = "#66717c";
  ctx.font = "22px sans-serif";
  ctx.fillText("上傳後可拖曳並縮放家長簽名欄", DEFAULT_DOC.width / 2, DEFAULT_DOC.height / 2 + 28);
}

function addField() {
  const y = Math.min(84, 70 + state.fields.length * 9);
  const field = {
    id: crypto.randomUUID(),
    label: "家長簽名",
    x: 56,
    y,
    w: 30,
    h: 8,
  };
  state.fields.push(field);
  state.selectedFieldId = field.id;
  renderAll();
}

async function generateParentLink() {
  if (!state.file) {
    setStatus(els.caseStatus, "請先上傳圖片或 PDF 同意書。", "error");
    return;
  }

  if (!state.fields.length) {
    setStatus(els.caseStatus, "請至少新增一個簽名欄。", "error");
    return;
  }

  els.generateLink.disabled = true;
  setStatus(els.caseStatus, "正在暫存到伺服器/Google Drive...", "");

  try {
    const response = await fetch("/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: state.title,
        text: state.text,
        file: state.file,
        fields: state.fields,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "建立家長連結失敗。");

    const url = new URL(payload.parentUrl, location.origin);
    els.parentLink.value = url.href;
    setStatus(els.caseStatus, `已建立一位家長專用連結，有效至 ${formatTime(payload.expiresAt)}。`, "success");
  } catch (error) {
    setStatus(els.caseStatus, error.message, "error");
  } finally {
    els.generateLink.disabled = false;
  }
}

async function copyParentLink() {
  if (!els.parentLink.value) {
    await generateParentLink();
  }

  if (!els.parentLink.value) return;
  await navigator.clipboard.writeText(els.parentLink.value);
  els.copyLink.textContent = "已複製";
  setTimeout(() => {
    els.copyLink.textContent = "複製連結";
  }, 1200);
}

function renderAll() {
  renderDocumentCanvas(els.teacherCanvas);
  renderDocumentCanvas(els.parentCanvas);
  syncDocumentRatio(els.teacherDoc);
  syncDocumentRatio(els.parentDoc);
  renderTeacherFields();
  renderParentFields();
  renderSignatureSelect();
}

function renderDocumentCanvas(canvas) {
  setCanvasSize(canvas, state.sourceCanvas.width || DEFAULT_DOC.width, state.sourceCanvas.height || DEFAULT_DOC.height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.sourceCanvas, 0, 0);
}

function syncDocumentRatio(doc) {
  const width = state.sourceCanvas.width || DEFAULT_DOC.width;
  const height = state.sourceCanvas.height || DEFAULT_DOC.height;
  doc.style.aspectRatio = `${width} / ${height}`;
}

function renderTeacherFields() {
  els.fieldLayer.innerHTML = "";
  state.fields.forEach((field) => {
    const node = createFieldNode(field, true);
    els.fieldLayer.appendChild(node);
  });
}

function renderParentFields() {
  els.parentFieldLayer.innerHTML = "";
  state.fields.forEach((field) => {
    const node = createFieldNode(field, false);
    const signature = state.signatures[field.id];
    if (signature) {
      const img = document.createElement("img");
      img.src = signature;
      img.alt = `${field.label}簽名`;
      node.textContent = "";
      node.appendChild(img);
    }
    node.addEventListener("click", () => {
      state.selectedFieldId = field.id;
      els.signatureSelect.value = field.id;
      renderParentFields();
    });
    els.parentFieldLayer.appendChild(node);
  });
}

function createFieldNode(field, editable) {
  const node = document.createElement("div");
  node.className = "signature-field";
  node.dataset.id = field.id;
  node.style.left = `${field.x}%`;
  node.style.top = `${field.y}%`;
  node.style.width = `${field.w}%`;
  node.style.height = `${field.h}%`;
  node.classList.toggle("selected", field.id === state.selectedFieldId);

  const label = document.createElement("span");
  label.className = "signature-label";
  label.textContent = field.label || "家長簽名";
  node.appendChild(label);

  if (editable) {
    node.addEventListener("pointerdown", (event) => startFieldDrag(event, node, field));
    const handle = document.createElement("span");
    handle.className = "resize-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (event) => startFieldResize(event, node, field));
    node.appendChild(handle);
  }

  return node;
}

function startFieldDrag(event, node, field) {
  if (event.target.closest(".resize-handle")) return;

  state.selectedFieldId = field.id;
  const doc = els.teacherDoc.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = field.x;
  const startTop = field.y;

  node.setPointerCapture(event.pointerId);
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", onUp, { once: true });

  function onMove(moveEvent) {
    const dx = ((moveEvent.clientX - startX) / doc.width) * 100;
    const dy = ((moveEvent.clientY - startY) / doc.height) * 100;
    field.x = clamp(startLeft + dx, 0, 100 - field.w);
    field.y = clamp(startTop + dy, 0, 100 - field.h);
    node.style.left = `${field.x}%`;
    node.style.top = `${field.y}%`;
  }

  function onUp() {
    node.removeEventListener("pointermove", onMove);
    syncFieldSize(node, field);
    renderAll();
  }
}

function startFieldResize(event, node, field) {
  event.stopPropagation();
  event.preventDefault();
  state.selectedFieldId = field.id;

  const doc = els.teacherDoc.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const startWidth = field.w;
  const startHeight = field.h;

  node.setPointerCapture(event.pointerId);
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", onUp, { once: true });

  function onMove(moveEvent) {
    const dw = ((moveEvent.clientX - startX) / doc.width) * 100;
    const dh = ((moveEvent.clientY - startY) / doc.height) * 100;
    field.w = clamp(startWidth + dw, 8, 100 - field.x);
    field.h = clamp(startHeight + dh, 4, 100 - field.y);
    node.style.width = `${field.w}%`;
    node.style.height = `${field.h}%`;
  }

  function onUp() {
    node.removeEventListener("pointermove", onMove);
    renderAll();
  }
}

function renderSignatureSelect() {
  els.signatureSelect.innerHTML = "";
  state.fields.forEach((field) => {
    const option = document.createElement("option");
    option.value = field.id;
    option.textContent = field.label;
    option.selected = field.id === state.selectedFieldId;
    els.signatureSelect.appendChild(option);
  });
}

function bindSignaturePad() {
  signatureContext.lineWidth = 4;
  signatureContext.lineCap = "round";
  signatureContext.lineJoin = "round";
  signatureContext.strokeStyle = "#111820";

  els.signaturePad.addEventListener("pointerdown", (event) => {
    drawing = true;
    signatureContext.beginPath();
    moveSignaturePen(event);
  });
  els.signaturePad.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    moveSignaturePen(event);
  });
  window.addEventListener("pointerup", () => {
    drawing = false;
  });
}

function moveSignaturePen(event) {
  const rect = els.signaturePad.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * els.signaturePad.width;
  const y = ((event.clientY - rect.top) / rect.height) * els.signaturePad.height;
  signatureContext.lineTo(x, y);
  signatureContext.stroke();
  signatureContext.beginPath();
  signatureContext.moveTo(x, y);
}

function clearSignaturePad() {
  signatureContext.fillStyle = "#fff";
  signatureContext.fillRect(0, 0, els.signaturePad.width, els.signaturePad.height);
}

function applySignature() {
  if (!state.selectedFieldId) return;
  state.signatures[state.selectedFieldId] = els.signaturePad.toDataURL("image/png");
  renderParentFields();
}

async function downloadSignedDocument() {
  if (!Object.keys(state.signatures).length) {
    setStatus(els.parentStatus, "請先套用簽名。", "error");
    return;
  }

  const canvas = await composeDocumentCanvas("signed");
  const dataUrl = canvas.toDataURL("image/png");
  downloadDataUrl(dataUrl, `${state.title || "同意書"}-已簽名.png`);
  els.completedImage.src = dataUrl;
  els.completedImage.classList.add("active");
  setStatus(els.parentStatus, "完成圖片已產生。若手機未自動下載，可長按下方圖片保存。", "success");

  if (state.caseId) {
    await fetch(`/api/cases/${state.caseId}/complete`, { method: "POST" }).catch(() => {});
  }
}

async function downloadDocument(kind) {
  const canvas = await composeDocumentCanvas(kind);
  downloadDataUrl(canvas.toDataURL("image/png"), `${state.title || "同意書"}-空白簽名欄預覽.png`);
}

async function composeDocumentCanvas(kind) {
  const canvas = document.createElement("canvas");
  setCanvasSize(canvas, state.sourceCanvas.width, state.sourceCanvas.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(state.sourceCanvas, 0, 0);

  for (const field of state.fields) {
    const x = (field.x / 100) * canvas.width;
    const y = (field.y / 100) * canvas.height;
    const w = (field.w / 100) * canvas.width;
    const h = (field.h / 100) * canvas.height;
    const signature = state.signatures[field.id];

    if (kind === "signed" && signature) {
      const image = await loadImage(signature);
      ctx.drawImage(image, x + w * 0.04, y + h * 0.08, w * 0.92, h * 0.84);
    } else {
      ctx.strokeStyle = "#176b87";
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = Math.max(2, canvas.width * 0.003);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#0f5369";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(18, Math.round(canvas.width * 0.025))}px sans-serif`;
      ctx.fillText(field.label, x + w / 2, y + h / 2);
    }
  }

  return canvas;
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

function setCanvasSize(canvas, width, height) {
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("檔案讀取失敗。"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片載入失敗。"));
    image.src = src;
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const paragraphs = (text || "").split("\n");
  let cursorY = y;

  paragraphs.forEach((paragraph) => {
    let line = "";
    Array.from(paragraph || " ").forEach((char) => {
      const testLine = line + char;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        ctx.fillText(line, x, cursorY);
        line = char;
        cursorY += lineHeight;
      } else {
        line = testLine;
      }
    });
    ctx.fillText(line, x, cursorY);
    cursorY += lineHeight;
  });
}

function setStatus(element, message, kind) {
  element.textContent = message || "";
  element.classList.toggle("error", kind === "error");
  element.classList.toggle("success", kind === "success");
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
