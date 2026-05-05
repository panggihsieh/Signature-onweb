const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_DOC = { width: 900, height: 1200 };
const SHARE_VERSION = 3;
const FIELD_DEFAULT = { x: 56, y: 72, w: 28, h: 9 };

const state = {
  title: "同意書",
  file: null,
  field: { ...FIELD_DEFAULT },
  locked: false,
  signatureDataUrl: "",
  sourceCanvas: document.createElement("canvas"),
  shareToken: "",
};

const els = {
  modeSummary: document.querySelector("#modeSummary"),
  uploadPanel: document.querySelector("#uploadPanel"),
  uploadZone: document.querySelector("#uploadZone"),
  fileInput: document.querySelector("#fileInput"),
  uploadStatus: document.querySelector("#uploadStatus"),
  layoutHint: document.querySelector("#layoutHint"),
  shareStatus: document.querySelector("#shareStatus"),
  signerHint: document.querySelector("#signerHint"),
  doc: document.querySelector("#doc"),
  docCanvas: document.querySelector("#docCanvas"),
  fieldLayer: document.querySelector("#fieldLayer"),
  copyLink: document.querySelector("#copyLink"),
  lockField: document.querySelector("#lockField"),
  qrPanel: document.querySelector("#qrPanel"),
  qrCode: document.querySelector("#qrCode"),
  signaturePad: document.querySelector("#signaturePad"),
  clearSignature: document.querySelector("#clearSignature"),
  applySignature: document.querySelector("#applySignature"),
  downloadImage: document.querySelector("#downloadImage"),
  shareImage: document.querySelector("#shareImage"),
  signStatus: document.querySelector("#signStatus"),
  completedImage: document.querySelector("#completedImage"),
};

const signatureContext = els.signaturePad?.getContext("2d") || null;
let drawing = false;

init();

async function init() {
  bindEvents();
  clearSignaturePad();
  loadShareStateFromUrl();
  updateShareLink();
  drawPlaceholder();
  renderAll();
}

function bindEvents() {
  preparePasteZone(els.uploadZone);
  els.fileInput?.addEventListener("change", handleFileInput);
  els.uploadZone?.addEventListener("click", () => els.uploadZone.focus());
  els.uploadZone?.addEventListener("paste", handlePaste);
  els.uploadZone?.addEventListener("dragover", handleDragOver);
  els.uploadZone?.addEventListener("dragleave", () => els.uploadZone.classList.remove("active"));
  els.uploadZone?.addEventListener("drop", handleDrop);
  window.addEventListener("paste", (event) => {
    if (!event.defaultPrevented) handlePaste(event);
  });

  els.copyLink?.addEventListener("click", copyShareLink);
  els.lockField?.addEventListener("click", toggleLockField);
  els.clearSignature?.addEventListener("click", clearSignaturePad);
  els.applySignature?.addEventListener("click", applySignature);
  els.downloadImage?.addEventListener("click", downloadSignedDocument);
  els.shareImage?.addEventListener("click", shareSignedDocument);

  bindSignaturePad();
}

function preparePasteZone(zone) {
  if (!zone) return;
  const helper = document.createElement("textarea");
  helper.setAttribute("aria-hidden", "true");
  helper.tabIndex = -1;
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  helper.style.pointerEvents = "none";
  helper.style.width = "1px";
  helper.style.height = "1px";
  helper.style.left = "-9999px";
  helper.style.top = "-9999px";
  document.body.appendChild(helper);

  zone.addEventListener("contextmenu", (event) => {
    helper.style.left = `${event.clientX}px`;
    helper.style.top = `${event.clientY}px`;
    helper.focus();
    helper.select();
  });

  zone.addEventListener("touchstart", (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    helper.style.left = `${touch.clientX}px`;
    helper.style.top = `${touch.clientY}px`;
    helper.style.width = "28px";
    helper.style.height = "28px";
    helper.style.opacity = "0.01";
    helper.style.pointerEvents = "auto";
    helper.focus();
    helper.select();
  }, { passive: true });

  zone.addEventListener("touchend", resetPasteHelper, { passive: true });
  helper.addEventListener("paste", async (event) => {
    await handlePaste(event);
    resetPasteHelper();
  });

  function resetPasteHelper() {
    window.setTimeout(() => {
      helper.value = "";
      helper.style.opacity = "0";
      helper.style.pointerEvents = "none";
      helper.style.width = "1px";
      helper.style.height = "1px";
      helper.style.left = "-9999px";
      helper.style.top = "-9999px";
    }, 800);
  }
}

function loadShareStateFromUrl() {
  const params = new URLSearchParams(location.search);
  const token = params.get("d");
  if (!token) return;

  try {
    const payload = decodeShareState(token);
    if (payload.version !== SHARE_VERSION) return;
    state.title = String(payload.title || state.title);
    state.field = normalizeField(payload.field);
    state.locked = Boolean(payload.locked);
    state.shareToken = token;
  } catch {
    setStatus(els.shareStatus, "分享網址讀取失敗，請重新複製網址。", "error");
  }
}

function normalizeField(field) {
  const next = { ...FIELD_DEFAULT, ...(field || {}) };
  next.x = clamp(Number(next.x) || FIELD_DEFAULT.x, 0, 90);
  next.y = clamp(Number(next.y) || FIELD_DEFAULT.y, 0, 92);
  next.w = clamp(Number(next.w) || FIELD_DEFAULT.w, 12, 60);
  next.h = clamp(Number(next.h) || FIELD_DEFAULT.h, 5, 25);
  return next;
}

function getSharePayload() {
  return {
    version: SHARE_VERSION,
    title: state.title || "同意書",
    field: {
      x: roundShareNumber(state.field.x),
      y: roundShareNumber(state.field.y),
      w: roundShareNumber(state.field.w),
      h: roundShareNumber(state.field.h),
    },
    locked: state.locked,
  };
}

function updateShareLink() {
  const url = new URL(location.href);
  const token = encodeShareState(getSharePayload());
  url.searchParams.set("d", token);
  state.shareToken = token;
  history.replaceState(null, "", url);
  renderQrCode(url.href);
  return url.href;
}

function renderAll() {
  renderModeText();
  renderSourceCanvas();
  renderField();
  renderSignerState();
}

function renderModeText() {
  els.uploadPanel?.toggleAttribute("hidden", state.locked);
  if (state.locked) {
    els.modeSummary.textContent = "目前是鎖定版網址。老師與家長都開同一頁，位置固定後直接簽名。";
    els.layoutHint.textContent = "簽名欄位已鎖定。現在可把網址傳給家長，家長只要上傳同意書圖片後就能簽名。";
    els.lockField.textContent = "欄位位置已鎖定";
    els.lockField.setAttribute("disabled", "true");
    els.lockField.classList.add("is-locked");
    els.copyLink.hidden = false;
  } else if (state.shareToken) {
    els.modeSummary.textContent = "目前是可調整版網址。老師或家長都能開同一頁，先調整簽名欄位，再按確認鎖定。";
    els.layoutHint.textContent = "請拖曳或縮放簽名欄位，確認位置後按「確認欄位並鎖定」。";
    els.lockField.removeAttribute("disabled");
    els.lockField.classList.remove("is-locked");
    els.lockField.textContent = "確認欄位並鎖定";
    els.copyLink.hidden = true;
    els.qrPanel.hidden = true;
  } else {
    els.modeSummary.textContent = "老師先在這裡上傳同意書圖片，預設會帶出一個簽名欄位，再複製網址分享出去。";
    els.layoutHint.textContent = "先上傳同意書圖片，再複製網址給家長。家長和老師都會開同一頁。";
    els.lockField.removeAttribute("disabled");
    els.lockField.classList.remove("is-locked");
    els.lockField.textContent = "確認欄位並鎖定";
    els.copyLink.hidden = true;
    els.qrPanel.hidden = true;
  }
}

async function handleFileInput(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await loadSelectedFile(file);
  event.target.value = "";
}

async function loadSelectedFile(file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    setStatus(els.uploadStatus, "檔案超過 5MB，請改用較小的圖片或 PDF。", "error");
    return;
  }

  if (!isSupportedFile(file)) {
    setStatus(els.uploadStatus, "只支援圖片或 PDF。", "error");
    return;
  }

  setStatus(els.uploadStatus, "正在讀取同意書...", "");

  try {
    const dataUrl = await readFileAsDataUrl(file);
    state.file = {
      name: file.name,
      type: file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : file.type,
      dataUrl,
    };
    state.title = file.name.replace(/\.[^.]+$/, "") || "同意書";
    state.signatureDataUrl = "";

    await drawSourceFromFile();
    renderAll();
    setStatus(els.uploadStatus, `${file.name} 已載入，可以開始調整或簽名。`, "success");
  } catch (error) {
    drawPlaceholder();
    renderAll();
    setStatus(els.uploadStatus, error.message || "檔案讀取失敗。", "error");
  }
}

async function drawSourceFromFile() {
  if (!state.file) {
    drawPlaceholder();
    return;
  }
  if (state.file.type === "application/pdf") {
    await drawPdfSource(state.file.dataUrl);
    return;
  }
  await drawImageSource(state.file.dataUrl);
}

function renderSourceCanvas() {
  const canvas = els.docCanvas;
  if (!canvas) return;
  setCanvasSize(canvas, state.sourceCanvas.width, state.sourceCanvas.height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.sourceCanvas, 0, 0);

  if (state.signatureDataUrl) {
    const img = new Image();
    img.onload = () => {
      const { x, y, w, h } = resolveFieldRect(canvas, state.field);
      ctx.drawImage(img, x + w * 0.04, y + h * 0.08, w * 0.92, h * 0.84);
    };
    img.src = state.signatureDataUrl;
  }
}

function renderField() {
  if (!els.fieldLayer) return;
  els.fieldLayer.innerHTML = "";

  const fieldNode = document.createElement("div");
  fieldNode.className = "signature-field";
  if (!state.locked) fieldNode.classList.add("editable");
  fieldNode.style.left = `${state.field.x}%`;
  fieldNode.style.top = `${state.field.y}%`;
  fieldNode.style.width = `${state.field.w}%`;
  fieldNode.style.height = `${state.field.h}%`;

  const label = document.createElement("span");
  label.className = "signature-label";
  label.textContent = state.locked ? "簽名位置已固定" : "拖曳或縮放簽名欄位";
  fieldNode.appendChild(label);

  if (!state.locked) {
    fieldNode.addEventListener("pointerdown", (event) => startFieldDrag(event, fieldNode));
    const resizeHandle = document.createElement("button");
    resizeHandle.type = "button";
    resizeHandle.className = "resize-handle";
    resizeHandle.setAttribute("aria-label", "縮放簽名欄位");
    resizeHandle.addEventListener("pointerdown", (event) => startFieldResize(event, fieldNode));
    fieldNode.appendChild(resizeHandle);
  }

  els.fieldLayer.appendChild(fieldNode);
}

function startFieldDrag(event, node) {
  if (state.locked || event.target.closest(".resize-handle")) return;
  event.preventDefault();
  const rect = els.doc.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = state.field.x;
  const startTop = state.field.y;

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
  window.addEventListener("pointercancel", onUp, { once: true });

  function onMove(moveEvent) {
    const dx = ((moveEvent.clientX - startX) / rect.width) * 100;
    const dy = ((moveEvent.clientY - startY) / rect.height) * 100;
    state.field.x = clamp(startLeft + dx, 0, 100 - state.field.w);
    state.field.y = clamp(startTop + dy, 0, 100 - state.field.h);
    node.style.left = `${state.field.x}%`;
    node.style.top = `${state.field.y}%`;
    updateShareLink();
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointercancel", onUp);
    renderField();
  }
}

function startFieldResize(event, node) {
  if (state.locked) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = els.doc.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const startWidth = state.field.w;
  const startHeight = state.field.h;

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
  window.addEventListener("pointercancel", onUp, { once: true });

  function onMove(moveEvent) {
    const dw = ((moveEvent.clientX - startX) / rect.width) * 100;
    const dh = ((moveEvent.clientY - startY) / rect.height) * 100;
    state.field.w = clamp(startWidth + dw, 12, 100 - state.field.x);
    state.field.h = clamp(startHeight + dh, 5, 100 - state.field.y);
    node.style.width = `${state.field.w}%`;
    node.style.height = `${state.field.h}%`;
    updateShareLink();
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointercancel", onUp);
    renderField();
  }
}

function toggleLockField() {
  if (state.locked) return;
  state.locked = true;
  const lockedLink = updateShareLink();
  renderAll();
  els.copyLink?.setAttribute("data-locked-url", lockedLink);
  setStatus(els.shareStatus, "欄位位置已鎖定。現在可以把這個同一網址傳給家長簽名。", "success");
}

async function copyShareLink() {
  const link = updateShareLink();
  const copied = copyTextToClipboard(link);
  if (copied) {
    setStatus(els.shareStatus, "分享網址已複製。可直接貼到 LINE 傳給家長。", "success");
    return;
  }
  setStatus(els.shareStatus, "網址已產生，請手動複製目前瀏覽器網址。", "error");
}

function renderQrCode(text) {
  if (!els.qrPanel || !els.qrCode || !window.QRCode) return;
  if (!state.locked) {
    els.qrPanel.hidden = true;
    return;
  }
  els.qrCode.innerHTML = "";
  new QRCode(els.qrCode, {
    text,
    width: 184,
    height: 184,
  });
  els.qrPanel.hidden = false;
}

function renderSignerState() {
  if (state.locked) {
    els.signerHint.textContent = "簽名欄已固定。請在下方手寫簽名，再套用到同意書。";
    els.applySignature.removeAttribute("disabled");
    els.applySignature.classList.toggle("is-applied", Boolean(state.signatureDataUrl));
    return;
  }
  els.signerHint.textContent = "請先調整簽名欄位並按「確認欄位並鎖定」，之後才會啟用簽名。";
  els.applySignature.setAttribute("disabled", "true");
  els.applySignature.classList.remove("is-applied");
}

function bindSignaturePad() {
  if (!signatureContext || !els.signaturePad) return;
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
  if (!signatureContext || !els.signaturePad) return;
  signatureContext.fillStyle = "#fff";
  signatureContext.fillRect(0, 0, els.signaturePad.width, els.signaturePad.height);
}

function applySignature() {
  if (!state.locked) {
    setStatus(els.signStatus, "請先確認欄位並鎖定位置。", "error");
    return;
  }

  if (!state.file) {
    setStatus(els.signStatus, "請先上傳同意書圖片。", "error");
    return;
  }

  state.signatureDataUrl = els.signaturePad.toDataURL("image/png");
  renderSourceCanvas();
  renderField();
  renderSignerState();
  setStatus(els.signStatus, "簽名已套用，可以下載或直接分享給老師。", "success");
}

async function downloadSignedDocument() {
  const canvas = await buildSignedCanvas();
  if (!canvas) return;
  const dataUrl = canvas.toDataURL("image/png");
  downloadDataUrl(dataUrl, `${state.title || "同意書"}-已簽名.png`);
  showCompletedPreview(dataUrl);
  setStatus(els.signStatus, "已下載簽名圖片。", "success");
}

async function shareSignedDocument() {
  const canvas = await buildSignedCanvas();
  if (!canvas) return;

  const fileName = `${state.title || "同意書"}-已簽名.png`;
  const blob = await canvasToBlob(canvas, "image/png");
  const file = new File([blob], fileName, { type: "image/png" });
  const dataUrl = canvas.toDataURL("image/png");
  showCompletedPreview(dataUrl);

  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({
        title: fileName,
        text: "已簽名同意書",
        files: [file],
      });
      setStatus(els.signStatus, "已開啟分享視窗，可以直接傳給老師。", "success");
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        setStatus(els.signStatus, "已取消分享。", "");
        return;
      }
    }
  }

  downloadDataUrl(dataUrl, fileName);
  setStatus(els.signStatus, "目前裝置不支援直接分享，已改為下載圖片。", "error");
}

async function buildSignedCanvas() {
  if (!state.file) {
    setStatus(els.signStatus, "請先上傳同意書圖片。", "error");
    return null;
  }

  if (!state.signatureDataUrl) {
    setStatus(els.signStatus, "請先套用簽名。", "error");
    return null;
  }

  const canvas = document.createElement("canvas");
  setCanvasSize(canvas, state.sourceCanvas.width, state.sourceCanvas.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(state.sourceCanvas, 0, 0);

  const signatureImage = await loadImage(state.signatureDataUrl);
  const { x, y, w, h } = resolveFieldRect(canvas, state.field);
  ctx.drawImage(signatureImage, x + w * 0.04, y + h * 0.08, w * 0.92, h * 0.84);
  return canvas;
}

function showCompletedPreview(dataUrl) {
  els.completedImage.src = dataUrl;
  els.completedImage.classList.add("active");
}

function resolveFieldRect(canvas, field) {
  return {
    x: (field.x / 100) * canvas.width,
    y: (field.y / 100) * canvas.height,
    w: (field.w / 100) * canvas.width,
    h: (field.h / 100) * canvas.height,
  };
}

function drawPlaceholder() {
  setCanvasSize(state.sourceCanvas, DEFAULT_DOC.width, DEFAULT_DOC.height);
  const ctx = state.sourceCanvas.getContext("2d");
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, DEFAULT_DOC.width, DEFAULT_DOC.height);
  ctx.fillStyle = "#14212b";
  ctx.textAlign = "center";
  ctx.font = "700 34px sans-serif";
  ctx.fillText("請先上傳同意書圖片", DEFAULT_DOC.width / 2, DEFAULT_DOC.height / 2 - 20);
  ctx.fillStyle = "#66717c";
  ctx.font = "22px sans-serif";
  ctx.fillText("老師與家長都使用同一頁面", DEFAULT_DOC.width / 2, DEFAULT_DOC.height / 2 + 28);
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
    const pdfModule = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
    window.pdfjsLib = pdfModule;
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

  const task = window.pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.6 });
  setCanvasSize(state.sourceCanvas, Math.round(viewport.width), Math.round(viewport.height));
  await page.render({
    canvasContext: state.sourceCanvas.getContext("2d"),
    viewport,
  }).promise;
}

function handleDragOver(event) {
  event.preventDefault();
  els.uploadZone?.classList.add("active");
}

async function handleDrop(event) {
  event.preventDefault();
  els.uploadZone?.classList.remove("active");
  const file = extractSupportedFile(event.dataTransfer);
  if (!file) {
    setStatus(els.uploadStatus, "拖曳進來的檔案不是圖片或 PDF。", "error");
    return;
  }
  await loadSelectedFile(file);
}

async function handlePaste(event) {
  const file = extractSupportedFile(event.clipboardData);
  if (file) {
    event.preventDefault();
    await loadSelectedFile(file);
    return;
  }

  const text = event.clipboardData?.getData("text/plain")?.trim();
  if (text && text.startsWith("data:image/")) {
    event.preventDefault();
    await loadSelectedFile(dataUrlToFile(text, "pasted-image.png"));
    return;
  }
}

function encodeShareState(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeShareState(token) {
  const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(normalized + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function roundShareNumber(value) {
  return Math.round(Number(value) * 100) / 100;
}

function copyTextToClipboard(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
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
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function dataUrlToFile(dataUrl, fallbackName) {
  const [header, base64 = ""] = dataUrl.split(",");
  const match = header.match(/^data:([^;]+);base64$/);
  if (!match) throw new Error("貼上的內容不是圖片。");

  const mimeType = match[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
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

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("圖片建立失敗。"));
    }, type);
  });
}

function setStatus(element, message, kind) {
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("error", kind === "error");
  element.classList.toggle("success", kind === "success");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
