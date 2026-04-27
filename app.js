const state = {
  title: "",
  text: "",
  driveLink: "",
  image: "",
  fields: [],
  signatures: {},
  selectedFieldId: "",
};

const els = {
  teacherTab: document.querySelector("#teacherTab"),
  parentTab: document.querySelector("#parentTab"),
  teacherView: document.querySelector("#teacherView"),
  parentView: document.querySelector("#parentView"),
  docTitle: document.querySelector("#docTitle"),
  docText: document.querySelector("#docText"),
  driveLink: document.querySelector("#driveLink"),
  fileInput: document.querySelector("#fileInput"),
  previewTitle: document.querySelector("#previewTitle"),
  previewText: document.querySelector("#previewText"),
  previewDrive: document.querySelector("#previewDrive"),
  teacherDoc: document.querySelector("#teacherDoc"),
  teacherImage: document.querySelector("#teacherImage"),
  fieldLayer: document.querySelector("#fieldLayer"),
  addSignature: document.querySelector("#addSignature"),
  clearFields: document.querySelector("#clearFields"),
  generateLink: document.querySelector("#generateLink"),
  parentLink: document.querySelector("#parentLink"),
  copyLink: document.querySelector("#copyLink"),
  downloadTeacherImage: document.querySelector("#downloadTeacherImage"),
  parentDoc: document.querySelector("#parentDoc"),
  parentImage: document.querySelector("#parentImage"),
  parentTitle: document.querySelector("#parentTitle"),
  parentText: document.querySelector("#parentText"),
  parentDrive: document.querySelector("#parentDrive"),
  parentFieldLayer: document.querySelector("#parentFieldLayer"),
  signatureSelect: document.querySelector("#signatureSelect"),
  signaturePad: document.querySelector("#signaturePad"),
  clearSignature: document.querySelector("#clearSignature"),
  applySignature: document.querySelector("#applySignature"),
  downloadParentImage: document.querySelector("#downloadParentImage"),
};

const signatureContext = els.signaturePad.getContext("2d");
let drawing = false;

function init() {
  hydrateFromHash();
  bindEvents();
  syncFromInputs();
  if (!state.fields.length) addField();
  renderAll();
}

function bindEvents() {
  els.teacherTab.addEventListener("click", () => setMode("teacher"));
  els.parentTab.addEventListener("click", () => setMode("parent"));
  els.docTitle.addEventListener("input", syncFromInputs);
  els.docText.addEventListener("input", syncFromInputs);
  els.driveLink.addEventListener("input", syncFromInputs);
  els.fileInput.addEventListener("change", handleFile);
  els.addSignature.addEventListener("click", addField);
  els.clearFields.addEventListener("click", () => {
    state.fields = [];
    state.signatures = {};
    renderAll();
  });
  els.generateLink.addEventListener("click", generateParentLink);
  els.copyLink.addEventListener("click", copyParentLink);
  els.downloadTeacherImage.addEventListener("click", () => downloadDocument("teacher"));
  els.downloadParentImage.addEventListener("click", () => downloadDocument("parent"));
  els.signatureSelect.addEventListener("change", () => {
    state.selectedFieldId = els.signatureSelect.value;
    renderParentFields();
  });
  els.clearSignature.addEventListener("click", clearSignaturePad);
  els.applySignature.addEventListener("click", applySignature);
  bindSignaturePad();
}

function hydrateFromHash() {
  if (!location.hash.startsWith("#parent=")) return;

  try {
    const encoded = location.hash.replace("#parent=", "");
    const payload = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    Object.assign(state, payload);
    els.docTitle.value = state.title || "";
    els.docText.value = state.text || "";
    els.driveLink.value = state.driveLink || "";
    setMode("parent");
  } catch {
    setMode("teacher");
  }
}

function syncFromInputs() {
  state.title = els.docTitle.value.trim() || "未命名同意書";
  state.text = els.docText.value;
  state.driveLink = els.driveLink.value.trim();
  renderAll();
}

function setMode(mode) {
  const isTeacher = mode === "teacher";
  els.teacherTab.classList.toggle("active", isTeacher);
  els.parentTab.classList.toggle("active", !isTeacher);
  els.teacherView.classList.toggle("active", isTeacher);
  els.parentView.classList.toggle("active", !isTeacher);
  if (!isTeacher && !state.selectedFieldId && state.fields[0]) {
    state.selectedFieldId = state.fields[0].id;
  }
  renderAll();
}

function handleFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    if (file.type.startsWith("image/")) {
      state.image = reader.result;
    } else {
      state.text = String(reader.result || "");
      els.docText.value = state.text;
    }
    renderAll();
  };

  if (file.type.startsWith("image/")) {
    reader.readAsDataURL(file);
  } else {
    reader.readAsText(file);
  }
}

function addField() {
  const index = state.fields.length + 1;
  state.fields.push({
    id: crypto.randomUUID(),
    label: `家長簽名 ${index}`,
    x: 56,
    y: 72 + state.fields.length * 10,
    w: 30,
    h: 9,
  });
  state.selectedFieldId = state.fields.at(-1).id;
  renderAll();
}

function renderAll() {
  renderDocumentBase("teacher");
  renderDocumentBase("parent");
  renderTeacherFields();
  renderParentFields();
  renderSignatureSelect();
}

function renderDocumentBase(target) {
  const prefix = target === "teacher" ? "preview" : "parent";
  const doc = target === "teacher" ? els.teacherDoc : els.parentDoc;
  const image = target === "teacher" ? els.teacherImage : els.parentImage;

  document.querySelector(`#${prefix}Title`).textContent = state.title;
  document.querySelector(`#${prefix}Text`).textContent = state.text;
  document.querySelector(`#${prefix}Drive`).textContent = state.driveLink
    ? `Google Drive 原始檔：${state.driveLink}`
    : "";

  if (state.image) {
    image.src = state.image;
    doc.classList.add("has-image");
    image.onload = () => syncImageDocumentHeight(doc, image);
    syncImageDocumentHeight(doc, image);
  } else {
    image.removeAttribute("src");
    doc.classList.remove("has-image");
    doc.style.height = "";
  }
}

function syncImageDocumentHeight(doc, image) {
  if (!image.naturalWidth) return;
  doc.style.height = `${doc.clientWidth * (image.naturalHeight / image.naturalWidth)}px`;
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
  node.textContent = field.label;
  node.style.left = `${field.x}%`;
  node.style.top = `${field.y}%`;
  node.style.width = `${field.w}%`;
  node.style.height = `${field.h}%`;
  node.classList.toggle("selected", field.id === state.selectedFieldId);

  if (editable) {
    node.addEventListener("pointerdown", (event) => startFieldDrag(event, node, field));
    new ResizeObserver(() => syncFieldSize(node, field)).observe(node);
  }

  return node;
}

function startFieldDrag(event, node, field) {
  if (event.target !== node) return;

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

function syncFieldSize(node, field) {
  const doc = els.teacherDoc.getBoundingClientRect();
  if (!doc.width || !doc.height) return;
  field.w = clamp((node.offsetWidth / doc.width) * 100, 12, 85);
  field.h = clamp((node.offsetHeight / doc.height) * 100, 5, 40);
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

function generateParentLink() {
  syncFromInputs();
  const payload = {
    title: state.title,
    text: state.text,
    driveLink: state.driveLink,
    image: state.image,
    fields: state.fields,
    signatures: {},
    selectedFieldId: state.fields[0]?.id || "",
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  els.parentLink.value = `${location.origin}${location.pathname}#parent=${encoded}`;
}

async function copyParentLink() {
  if (!els.parentLink.value) generateParentLink();
  await navigator.clipboard.writeText(els.parentLink.value);
  els.copyLink.textContent = "已複製";
  setTimeout(() => {
    els.copyLink.textContent = "複製連結";
  }, 1200);
}

function bindSignaturePad() {
  signatureContext.lineWidth = 3;
  signatureContext.lineCap = "round";
  signatureContext.strokeStyle = "#111820";
  clearSignaturePad();

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

async function downloadDocument(mode) {
  const canvas = await renderDocumentToCanvas(mode);
  const link = document.createElement("a");
  link.download = `${state.title || "同意書"}-${mode === "parent" ? "已簽名" : "預覽"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function renderDocumentToCanvas(mode) {
  const source = mode === "teacher" ? els.teacherDoc : els.parentDoc;
  const rect = source.getBoundingClientRect();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (state.image) {
    const image = await loadImage(state.image);
    ctx.drawImage(image, 0, 0, rect.width, rect.height);
  } else {
    drawTextDocument(ctx, rect.width);
  }

  for (const field of state.fields) {
    const x = (field.x / 100) * rect.width;
    const y = (field.y / 100) * rect.height;
    const w = (field.w / 100) * rect.width;
    const h = (field.h / 100) * rect.height;
    const signature = state.signatures[field.id];

    if (signature && mode === "parent") {
      const image = await loadImage(signature);
      ctx.drawImage(image, x + 6, y + 4, w - 12, h - 8);
    } else {
      ctx.strokeStyle = "#176b87";
      ctx.setLineDash([7, 5]);
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#0f5369";
      ctx.font = "700 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(field.label, x + w / 2, y + h / 2);
    }
  }

  return canvas;
}

function drawTextDocument(ctx, width) {
  ctx.fillStyle = "#14212b";
  ctx.textAlign = "center";
  ctx.font = "700 28px sans-serif";
  ctx.fillText(state.title, width / 2, 92);

  ctx.textAlign = "left";
  ctx.font = "18px sans-serif";
  wrapText(ctx, state.text, 64, 140, width - 128, 32);
  if (state.driveLink) {
    ctx.fillStyle = "#66717c";
    wrapText(ctx, `Google Drive 原始檔：${state.driveLink}`, 64, 930, width - 128, 28);
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const paragraphs = text.split("\n");
  let cursorY = y;
  paragraphs.forEach((paragraph) => {
    let line = "";
    Array.from(paragraph).forEach((char) => {
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

init();
