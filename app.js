const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_DOC = {
  width: 900,
  height: 1200,
};
const SHARE_LAYOUT_VERSION = 2;

const state = {
  mode: "teacher",
  title: "",
  file: null,
  fields: [],
  signatures: {},
  selectedFieldId: "",
  layoutSource: null,
  sourceCanvas: document.createElement("canvas"),
};

const els = {
  teacherTab: document.querySelector("#teacherTab"),
  parentTab: document.querySelector("#parentTab"),
  teacherView: document.querySelector("#teacherView"),
  parentView: document.querySelector("#parentView"),
  fileInput: document.querySelector("#fileInput"),
  parentFileInput: document.querySelector("#parentFileInput"),
  pasteZone: document.querySelector("#pasteZone"),
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

  const params = new URLSearchParams(location.search);
  const legacyCaseId = params.get("case");
  const layoutToken = params.get("layout");

  if (layoutToken) {
    loadSharedLayout(layoutToken);
    return;
  }

  if (legacyCaseId) {
    setMode("parent");
    drawPlaceholder("第二版不再使用第一版暫存連結", "請老師重新產生第二版排版連結，並把同意書原檔一起傳給家長。");
    setStatus(els.parentStatus, "此連結屬於第一版流程，請改用第二版重新產生。", "error");
    return;
  }

  drawPlaceholder("請先上傳圖片或 PDF 同意書", "上傳後可拖曳並縮放家長簽名欄");
  addField();
  setMode("teacher");
}

function bindEvents() {
  els.teacherTab.addEventListener("click", () => setMode("teacher"));
  els.parentTab.addEventListener("click", () => setMode("parent"));
  els.fileInput.addEventListener("change", (event) => handleFileInput(event, "teacher"));
  els.parentFileInput.addEventListener("change", (event) => handleFileInput(event, "parent"));
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
  els.pasteZone.addEventListener("click", () => els.pasteZone.focus());
  els.pasteZone.addEventListener("paste", handleParentPaste);
  els.pasteZone.addEventListener("dragover", handlePasteZoneDragOver);
  els.pasteZone.addEventListener("dragleave", () => els.pasteZone.classList.remove("active"));
  els.pasteZone.addEventListener("drop", handleParentDrop);
  window.addEventListener("paste", (event) => {
    if (state.mode !== "parent" || event.defaultPrevented) return;
    handleParentPaste(event);
  });
  bindSignaturePad();
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

async function handleFileInput(event, role) {
  const file = event.target.files[0];
  if (!file) return;
  await loadSelectedFile(file, role);
  event.target.value = "";
}

async function loadSelectedFile(file, role) {
  const statusEl = role === "teacher" ? els.uploadStatus : els.parentStatus;

  if (file.size > MAX_UPLOAD_BYTES) {
    setStatus(statusEl, "檔案超過 5MB，請壓縮後再上傳。", "error");
    return;
  }

  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isImage && !isPdf) {
    setStatus(statusEl, "目前僅支援圖片與 PDF。", "error");
    return;
  }

  setStatus(statusEl, "正在載入檔案...", "");

  try {
    const dataUrl = await readFileAsDataUrl(file);
    state.file = {
      name: file.name,
      type: isPdf ? "application/pdf" : file.type,
      size: file.size,
      dataUrl,
    };
    state.signatures = {};
    if (role === "teacher") {
      state.title = file.name.replace(/\.[^.]+$/, "") || "同意書";
    }

    await renderSourceFromState();

    if (role === "teacher") {
      state.layoutSource = {
        width: state.sourceCanvas.width,
        height: state.sourceCanvas.height,
      };
      setStatus(statusEl, `${file.name} 已載入，現在可調整簽名欄位置。`, "success");
    } else {
      reportParentDocumentStatus(file.name);
    }

    renderAll();
  } catch (error) {
    state.file = null;
    drawPlaceholder("檔案載入失敗", "請重新選擇圖片或 PDF");
    renderAll();
    setStatus(statusEl, error.message, "error");
  }
}

async function renderSourceFromState() {
  if (!state.file) {
    drawPlaceholder("請先上傳同意書", "老師端用來排版，家長端用來簽名");
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

function drawPlaceholder(title, subtitle) {
  setCanvasSize(state.sourceCanvas, DEFAULT_DOC.width, DEFAULT_DOC.height);
  const ctx = state.sourceCanvas.getContext("2d");
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, DEFAULT_DOC.width, DEFAULT_DOC.height);
  ctx.fillStyle = "#14212b";
  ctx.textAlign = "center";
  ctx.font = "700 34px sans-serif";
  ctx.fillText(title, DEFAULT_DOC.width / 2, DEFAULT_DOC.height / 2 - 20);
  ctx.fillStyle = "#66717c";
  ctx.font = "22px sans-serif";
  ctx.fillText(subtitle, DEFAULT_DOC.width / 2, DEFAULT_DOC.height / 2 + 28);
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

function generateParentLink() {
  if (!state.file) {
    setStatus(els.caseStatus, "請先上傳圖片或 PDF 同意書。", "error");
    return;
  }

  if (!state.fields.length) {
    setStatus(els.caseStatus, "請至少新增一個簽名欄。", "error");
    return;
  }

  const sharePayload = {
    version: SHARE_LAYOUT_VERSION,
    title: state.title || "同意書",
    source: {
      width: state.sourceCanvas.width,
      height: state.sourceCanvas.height,
    },
    fields: state.fields.map((field) => ({
      id: field.id,
      label: field.label,
      x: roundShareNumber(field.x),
      y: roundShareNumber(field.y),
      w: roundShareNumber(field.w),
      h: roundShareNumber(field.h),
    })),
  };

  const url = new URL("/index.html", location.origin);
  url.searchParams.set("layout", encodeShareLayout(sharePayload));
  els.parentLink.value = url.href;
  setStatus(els.caseStatus, "已產生第二版家長連結。請把這個網址和同意書原檔一起傳給家長。", "success");
}

async function copyParentLink() {
  if (!els.parentLink.value) {
    generateParentLink();
  }

  if (!els.parentLink.value) return;
  await navigator.clipboard.writeText(els.parentLink.value);
  els.copyLink.textContent = "已複製";
  setTimeout(() => {
    els.copyLink.textContent = "複製連結";
  }, 1200);
}

function loadSharedLayout(layoutToken) {
  try {
    const layout = decodeShareLayout(layoutToken);
    if (layout.version !== SHARE_LAYOUT_VERSION) {
      throw new Error("排版連結版本不符，請老師重新產生。");
    }

    state.title = String(layout.title || "同意書");
    state.fields = normalizeSharedFields(layout.fields);
    state.selectedFieldId = state.fields[0]?.id || "";
    state.layoutSource = layout.source || null;
    state.file = null;
    state.signatures = {};
    drawPlaceholder("請貼上或上傳老師傳給你的同意書", "圖片可直接貼上，PDF 請改用上傳。");
    setMode("parent");
    renderAll();
    setStatus(els.parentStatus, "排版連結已載入。請先貼上或上傳老師傳來的同意書，再進行簽名。", "success");
  } catch (error) {
    setMode("parent");
    drawPlaceholder("排版連結無法讀取", "請老師重新產生第二版家長連結。");
    renderAll();
    setStatus(els.parentStatus, error.message, "error");
  }
}

function normalizeSharedFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field, index) => ({
      id: typeof field.id === "string" && field.id ? field.id : `field-${index + 1}`,
      label: typeof field.label === "string" && field.label ? field.label.slice(0, 40) : `家長簽名 ${index + 1}`,
      x: clamp(Number(field.x) || 0, 0, 100),
      y: clamp(Number(field.y) || 0, 0, 100),
      w: clamp(Number(field.w) || 8, 8, 100),
      h: clamp(Number(field.h) || 4, 4, 50),
    }))
    .filter((field) => field.w > 0 && field.h > 0)
    .slice(0, 12);
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
  if (!state.selectedFieldId) {
    setStatus(els.parentStatus, "目前沒有可簽名的欄位。", "error");
    return;
  }

  if (!state.file) {
    setStatus(els.parentStatus, "請先貼上或上傳老師傳來的同意書。", "error");
    return;
  }

  state.signatures[state.selectedFieldId] = els.signaturePad.toDataURL("image/png");
  renderParentFields();
  setStatus(els.parentStatus, "簽名已套用到目前欄位。", "success");
}

async function downloadSignedDocument() {
  if (!state.file) {
    setStatus(els.parentStatus, "請先貼上或上傳老師傳來的同意書。", "error");
    return;
  }

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
}

async function downloadDocument(kind) {
  if (!state.file) {
    setStatus(els.caseStatus, "請先上傳同意書，再下載預覽圖。", "error");
    return;
  }

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

function handlePasteZoneDragOver(event) {
  event.preventDefault();
  els.pasteZone.classList.add("active");
}

async function handleParentDrop(event) {
  event.preventDefault();
  els.pasteZone.classList.remove("active");
  const file = extractSupportedFile(event.dataTransfer);
  if (!file) {
    setStatus(els.parentStatus, "拖曳內容不是可用的圖片或 PDF。", "error");
    return;
  }
  await loadSelectedFile(file, "parent");
}

async function handleParentPaste(event) {
  const file = extractSupportedFile(event.clipboardData);
  if (file) {
    event.preventDefault();
    await loadSelectedFile(file, "parent");
    return;
  }

  const text = event.clipboardData?.getData("text/plain")?.trim();
  if (text && text.startsWith("data:image/")) {
    event.preventDefault();
    await loadSelectedFile(dataUrlToFile(text, "pasted-image.png"), "parent");
  }
}

function extractSupportedFile(dataTransfer) {
  if (!dataTransfer) return null;

  const directFile = Array.from(dataTransfer.files || []).find(isSupportedFile);
  if (directFile) return directFile;

  for (const item of Array.from(dataTransfer.items || [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isSupportedFile(file)) return file;
  }

  return null;
}

function isSupportedFile(file) {
  const type = String(file.type || "");
  const name = String(file.name || "").toLowerCase();
  return type.startsWith("image/") || type === "application/pdf" || name.endsWith(".pdf");
}

function reportParentDocumentStatus(fileName) {
  const layoutRatio = getLayoutRatio(state.layoutSource);
  const docRatio = getLayoutRatio({
    width: state.sourceCanvas.width,
    height: state.sourceCanvas.height,
  });

  if (!layoutRatio || !docRatio) {
    setStatus(els.parentStatus, `${fileName} 已載入，現在可點選簽名欄開始簽名。`, "success");
    return;
  }

  const ratioDiff = Math.abs(layoutRatio - docRatio);
  if (ratioDiff > 0.03) {
    setStatus(
      els.parentStatus,
      `${fileName} 已載入，但版面比例和老師排版不同，簽名欄可能偏移。請改用老師傳來的原檔或同一張截圖。`,
      "error",
    );
    return;
  }

  setStatus(els.parentStatus, `${fileName} 已載入，現在可點選簽名欄開始簽名。`, "success");
}

function getLayoutRatio(size) {
  if (!size?.width || !size?.height) return 0;
  return Number(size.width) / Number(size.height);
}

function encodeShareLayout(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeShareLayout(token) {
  const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(normalized + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function roundShareNumber(value) {
  return Math.round(Number(value) * 100) / 100;
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

function dataUrlToFile(dataUrl, fallbackName) {
  const [header, base64 = ""] = dataUrl.split(",");
  const match = header.match(/^data:([^;]+);base64$/);
  if (!match) {
    throw new Error("貼上的資料不是可用圖片。");
  }

  const mimeType = match[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fallbackName, { type: mimeType });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片載入失敗。"));
    image.src = src;
  });
}

function setStatus(element, message, kind) {
  element.textContent = message || "";
  element.classList.toggle("error", kind === "error");
  element.classList.toggle("success", kind === "success");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
