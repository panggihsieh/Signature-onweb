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
  monitorId: "",
  watchMode: false,
  lastWatchPreview: "",
  sourceCanvas: document.createElement("canvas"),
};

const els = {
  teacherView: document.querySelector("#teacherView"),
  parentView: document.querySelector("#parentView"),
  fileInput: document.querySelector("#fileInput"),
  parentFileInput: document.querySelector("#parentFileInput"),
  teacherPasteZone: document.querySelector("#teacherPasteZone"),
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
  parentLink: document.querySelector("#parentLink"),
  copyLink: document.querySelector("#copyLink"),
  qrPanel: document.querySelector("#qrPanel"),
  qrCode: document.querySelector("#qrCode"),
  downloadQrCode: document.querySelector("#downloadQrCode"),
  signatureSelect: document.querySelector("#signatureSelect"),
  signaturePad: document.querySelector("#signaturePad"),
  clearSignature: document.querySelector("#clearSignature"),
  applySignature: document.querySelector("#applySignature"),
  downloadParentImage: document.querySelector("#downloadParentImage"),
  shareParentImage: document.querySelector("#shareParentImage"),
  completedImage: document.querySelector("#completedImage"),
  monitorTitle: document.querySelector("#monitorTitle"),
  monitorState: document.querySelector("#monitorState"),
  monitorDetail: document.querySelector("#monitorDetail"),
  monitorUpdated: document.querySelector("#monitorUpdated"),
};

const pageMode = document.body.dataset.page || "teacher";
const signatureContext = els.signaturePad?.getContext("2d") || null;
let drawing = false;

init();

async function init() {
  bindEvents();
  clearSignaturePad();

  if (pageMode === "monitor") {
    initMonitorPage();
    return;
  }

  const params = new URLSearchParams(location.search);
  const layoutToken = params.get("layout");
  state.monitorId = params.get("monitor") || "";
  state.watchMode = params.get("watch") === "1";

  if (layoutToken) {
    loadSharedLayout(layoutToken);
    if (state.watchMode) {
      disableParentEditingForWatch();
      initParentWatchMode();
      return;
    }
    reportSigningEvent("opened");
    return;
  }
  drawPlaceholder("請先上傳圖片或 PDF 同意書", "上傳後可拖曳並縮放家長簽名欄");
  if (pageMode === "parent") {
    drawPlaceholder("請載入老師提供的同意書", "請上傳或貼上老師傳來的同一份圖片或 PDF");
    setMode("parent");
    focusParentPasteZone();
    return;
  }

  addField();
  setMode("teacher");
  prepareSigningSession();
}

function bindEvents() {
  els.fileInput?.addEventListener("change", (event) => handleFileInput(event, "teacher"));
  els.parentFileInput?.addEventListener("change", (event) => handleFileInput(event, "parent"));
  els.teacherPasteZone?.addEventListener("click", () => els.teacherPasteZone.focus());
  els.teacherPasteZone?.addEventListener("paste", (event) => handleDocumentPaste(event, "teacher"));
  els.teacherPasteZone?.addEventListener("dragover", (event) => handlePasteZoneDragOver(event, els.teacherPasteZone));
  els.teacherPasteZone?.addEventListener("dragleave", () => els.teacherPasteZone.classList.remove("active"));
  els.teacherPasteZone?.addEventListener("drop", (event) => handleDocumentDrop(event, "teacher", els.teacherPasteZone));
  els.addSignature?.addEventListener("click", addField);
  els.clearFields?.addEventListener("click", () => {
    state.fields = [];
    state.selectedFieldId = "";
    renderAll();
  });
  els.copyLink?.addEventListener("click", copyParentLink);
  els.downloadQrCode?.addEventListener("click", downloadQrCode);
  els.signatureSelect?.addEventListener("change", () => {
    state.selectedFieldId = els.signatureSelect.value;
    renderParentFields();
  });
  els.clearSignature?.addEventListener("click", clearSignaturePad);
  els.applySignature?.addEventListener("click", applySignature);
  els.downloadParentImage?.addEventListener("click", downloadSignedDocument);
  els.shareParentImage?.addEventListener("click", shareSignedDocument);
  els.pasteZone?.addEventListener("click", () => els.pasteZone.focus());
  els.pasteZone?.addEventListener("paste", handleParentPaste);
  els.pasteZone?.addEventListener("dragover", (event) => handlePasteZoneDragOver(event, els.pasteZone));
  els.pasteZone?.addEventListener("dragleave", () => els.pasteZone.classList.remove("active"));
  els.pasteZone?.addEventListener("drop", (event) => handleDocumentDrop(event, "parent", els.pasteZone));
  window.addEventListener("paste", (event) => {
    if (event.defaultPrevented) return;
    if (pageMode === "teacher" && state.mode === "teacher") {
      handleDocumentPaste(event, "teacher");
      return;
    }
    if (state.mode === "parent") {
      handleDocumentPaste(event, "parent");
    }
  });
  bindSignaturePad();
}

function setMode(mode) {
  state.mode = mode;
  const isTeacher = mode === "teacher";  els.teacherView?.classList.toggle("active", isTeacher);
  els.parentView?.classList.toggle("active", !isTeacher);
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
    if (role === "parent") {
      normalizeSourceCanvasToSharedLayout();
    }

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

function normalizeSourceCanvasToSharedLayout() {
  if (pageMode !== "parent" || !state.layoutSource) return;

  const width = Math.round(Number(state.layoutSource.width) || 0);
  const height = Math.round(Number(state.layoutSource.height) || 0);
  if (!width || !height) return;
  if (state.sourceCanvas.width === width && state.sourceCanvas.height === height) return;

  const current = document.createElement("canvas");
  setCanvasSize(current, state.sourceCanvas.width, state.sourceCanvas.height);
  current.getContext("2d").drawImage(state.sourceCanvas, 0, 0);

  setCanvasSize(state.sourceCanvas, width, height);
  const ctx = state.sourceCanvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(current, 0, 0, width, height);
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
  if (!state.fields.length) {
    setStatus(els.caseStatus, "請至少新增一個簽名欄。", "error");
    return "";
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

  const url = new URL("parent.html", location.href);
  url.searchParams.set("layout", encodeShareLayout(sharePayload));
  const monitorId = await ensureSigningSession();
  if (monitorId) {
    url.searchParams.set("monitor", monitorId);
  }
  els.parentLink.value = url.href;
  els.parentLink.focus();
  els.parentLink.select();
  const qrRendered = renderQrCode(url.href);
  if (qrRendered) {
    const message = state.file
      ? "已產生家長端連結與 QR Code。請把同意書原檔一起傳給家長。"
      : "已用預設版面產生家長端連結與 QR Code。請確認欄位位置後再分享。";
    setStatus(els.caseStatus, message, "success");
  }
  return url.href;
}

async function copyParentLink() {
  const watchWindow = window.open("about:blank", "_blank");
  renderWatchLoadingPage(watchWindow);
  const link = els.parentLink.value || await generateParentLink();
  if (!link) {
    renderWatchFailedPage(watchWindow);
    return;
  }

  openParentWatchTab(link, watchWindow);

  const copied = copyTextToClipboard(link);
  if (copied) {
    els.parentLink.focus();
    els.parentLink.select();
    setStatus(els.caseStatus, "家長端分享連結已複製，也已產生 QR Code。", "success");
    els.copyLink.textContent = "已複製分享連結";
    setTimeout(() => {
      els.copyLink.textContent = "複製家長端分享連結";
    }, 1200);
    return;
  }

  els.parentLink.focus();
  els.parentLink.select();
  setStatus(els.caseStatus, "瀏覽器未允許自動複製，已選取家長端連結，請按 Ctrl+C 複製。QR Code 已保留在下方。", "error");
}

async function ensureSigningSession() {
  if (state.monitorId) {    return state.monitorId;
  }

  try {
    const response = await fetch("/api/signing-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: state.title || "同意書" }),
    });
    if (!response.ok) throw new Error("monitor_unavailable");
    const session = await response.json();
    state.monitorId = session.id;    return session.id;
  } catch {    setStatus(els.caseStatus, "分享連結已產生，但目前無法建立即時監控頁。請確認本機服務已啟動。", "error");
    return "";
  }
}

async function prepareSigningSession() {
  if (pageMode !== "teacher") return;  if (state.monitorId) return;

  try {
    const response = await fetch("/api/signing-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: state.title || "同意書" }),
    });
    if (!response.ok) return;
    const session = await response.json();
    state.monitorId = session.id;
  } catch {
    // The share action will show a user-facing error if monitoring is still unavailable.
  }
}

function openParentWatchTab(parentLink, watchWindow) {
  try {
    const url = new URL(parentLink);
    url.searchParams.set("watch", "1");
    if (watchWindow && !watchWindow.closed) {
      watchWindow.location.href = url.href;
      return;
    }
    window.open(url.href, "_blank");
  } catch {
    renderWatchLinkFallbackPage(watchWindow, parentLink);
    // ignore
  }
}

function renderWatchLoadingPage(watchWindow) {
  if (!watchWindow || watchWindow.closed) return;
  try {
    watchWindow.document.write(
      "<!doctype html><meta charset='utf-8'><title>載入中</title><body style='font-family:sans-serif;padding:24px;line-height:1.7'>正在開啟家長端分頁，請稍候…</body>",
    );
    watchWindow.document.close();
  } catch {
    // ignore
  }
}

function renderWatchFailedPage(watchWindow) {
  if (!watchWindow || watchWindow.closed) return;
  try {
    watchWindow.document.write(
      "<!doctype html><meta charset='utf-8'><title>開啟失敗</title><body style='font-family:sans-serif;padding:24px;line-height:1.7'>無法產生家長端連結，請回到老師頁面重新操作。</body>",
    );
    watchWindow.document.close();
  } catch {
    // ignore
  }
}

function renderWatchLinkFallbackPage(watchWindow, parentLink) {
  if (!watchWindow || watchWindow.closed) return;
  try {
    const safeUrl = String(parentLink || "").replace(/"/g, "&quot;");
    watchWindow.document.write(
      `<!doctype html><meta charset='utf-8'><title>點擊開啟</title><body style='font-family:sans-serif;padding:24px;line-height:1.7'>自動開啟失敗，請點下方連結：<br><a href="${safeUrl}" target="_self" rel="noopener">開啟家長端分頁</a></body>`,
    );
    watchWindow.document.close();
  } catch {
    // ignore
  }
}

function getMonitorIdFromLink(link) {
  try {
    return new URL(link).searchParams.get("monitor") || "";
  } catch {
    return "";
  }
}

function copyTextToClipboard(text) {
  if (!text) return false;

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    if (copied) return true;
  } catch {
    // Fall through to the async Clipboard API fallback.
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }

  return false;
}

function renderQrCode(text) {
  if (!els.qrPanel || !els.qrCode) return false;

  els.qrCode.innerHTML = "";
  els.qrPanel.hidden = false;

  if (typeof QRCode !== "function") {
    setStatus(els.caseStatus, "家長端連結已產生，但 QR Code 套件尚未載入。請先使用複製連結。", "error");
    return false;
  }

  new QRCode(els.qrCode, {
    text,
    width: 184,
    height: 184,
    colorDark: "#14212b",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M,
  });
  return true;
}

function downloadQrCode() {
  if (!els.qrCode) return;

  const canvas = els.qrCode.querySelector("canvas");
  if (canvas) {
    downloadDataUrl(canvas.toDataURL("image/png"), "家長端連結-QRCode.png");
    return;
  }

  const image = els.qrCode.querySelector("img");
  if (image?.src) {
    downloadDataUrl(image.src, "家長端連結-QRCode.png");
  }
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
    normalizeSourceCanvasToSharedLayout();
    setMode("parent");
    renderAll();
    setStatus(els.parentStatus, "排版連結已載入。請先貼上或上傳老師傳來的同意書，再進行簽名。", "success");
    focusParentPasteZone();
  } catch (error) {
    setMode("parent");
    drawPlaceholder("排版連結無法讀取", "請老師重新產生第二版家長連結。");
    renderAll();
    setStatus(els.parentStatus, error.message, "error");
  }
}

function focusParentPasteZone() {
  window.setTimeout(() => els.pasteZone?.focus(), 0);
}

function disableParentEditingForWatch() {
  els.parentFileInput?.setAttribute("disabled", "true");
  els.signatureSelect?.setAttribute("disabled", "true");
  els.clearSignature?.setAttribute("disabled", "true");
  els.applySignature?.setAttribute("disabled", "true");
  els.downloadParentImage?.setAttribute("disabled", "true");
  els.shareParentImage?.setAttribute("disabled", "true");
  if (els.pasteZone) {
    els.pasteZone.tabIndex = -1;
    els.pasteZone.setAttribute("aria-disabled", "true");
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
  if (!canvas) return;
  setCanvasSize(canvas, state.sourceCanvas.width || DEFAULT_DOC.width, state.sourceCanvas.height || DEFAULT_DOC.height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.sourceCanvas, 0, 0);
}

function syncDocumentRatio(doc) {
  if (!doc) return;
  const width = state.sourceCanvas.width || DEFAULT_DOC.width;
  const height = state.sourceCanvas.height || DEFAULT_DOC.height;
  doc.style.aspectRatio = `${width} / ${height}`;
}

function renderTeacherFields() {
  if (!els.fieldLayer) return;
  els.fieldLayer.innerHTML = "";
  state.fields.forEach((field) => {
    const node = createFieldNode(field, true);
    els.fieldLayer.appendChild(node);
  });
}

function renderParentFields() {
  if (!els.parentFieldLayer) return;
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
  node.classList.toggle("editable", editable);
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
    handle.title = "拖曳調整簽名欄大小";
    handle.addEventListener("pointerdown", (event) => startFieldResize(event, node, field));
    node.appendChild(handle);
  }

  return node;
}

function startFieldDrag(event, node, field) {
  if (event.target.closest(".resize-handle")) return;
  event.preventDefault();

  state.selectedFieldId = field.id;
  const doc = els.teacherDoc.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = field.x;
  const startTop = field.y;

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
  window.addEventListener("pointercancel", onUp, { once: true });

  function onMove(moveEvent) {
    const dx = ((moveEvent.clientX - startX) / doc.width) * 100;
    const dy = ((moveEvent.clientY - startY) / doc.height) * 100;
    field.x = clamp(startLeft + dx, 0, 100 - field.w);
    field.y = clamp(startTop + dy, 0, 100 - field.h);
    node.style.left = `${field.x}%`;
    node.style.top = `${field.y}%`;
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointercancel", onUp);
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

  node.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
  window.addEventListener("pointercancel", onUp, { once: true });

  function onMove(moveEvent) {
    const dw = ((moveEvent.clientX - startX) / doc.width) * 100;
    const dh = ((moveEvent.clientY - startY) / doc.height) * 100;
    field.w = clamp(startWidth + dw, 8, 100 - field.x);
    field.h = clamp(startHeight + dh, 4, 100 - field.y);
    node.style.width = `${field.w}%`;
    node.style.height = `${field.h}%`;
  }

  function onUp() {
    node.releasePointerCapture?.(event.pointerId);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointercancel", onUp);
    renderAll();
  }
}

function renderSignatureSelect() {
  if (!els.signatureSelect) return;
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
  if (state.watchMode) return;
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
  reportSigningEvent("signed");
  pushSigningPreview().catch(() => {});
  setStatus(els.parentStatus, "簽名已套用到目前欄位。", "success");
}

async function downloadSignedDocument() {
  const canvas = await buildSignedDocumentForParent();
  if (!canvas) return;

  const dataUrl = canvas.toDataURL("image/png");
  downloadDataUrl(dataUrl, `${state.title || "同意書"}-已簽名.png`);
  els.completedImage.src = dataUrl;
  els.completedImage.classList.add("active");
  reportSigningEvent("completed");
  pushSigningPreview().catch(() => {});
  setStatus(els.parentStatus, "完成圖片已產生。若手機未自動下載，可長按下方圖片保存。", "success");
}

async function shareSignedDocument() {
  const canvas = await buildSignedDocumentForParent();
  if (!canvas) return;

  const fileName = `${state.title || "同意書"}-已簽名.png`;
  const blob = await canvasToBlob(canvas, "image/png");
  const file = new File([blob], fileName, { type: "image/png" });
  const dataUrl = canvas.toDataURL("image/png");
  els.completedImage.src = dataUrl;
  els.completedImage.classList.add("active");

  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({
        title: fileName,
        text: "已簽名同意書",
        files: [file],
      });
      reportSigningEvent("completed");
      pushSigningPreview().catch(() => {});
      setStatus(els.parentStatus, "已開啟分享選單，請選擇要傳送的通訊軟體。", "success");
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        setStatus(els.parentStatus, "已取消分享。", "");
        return;
      }
    }
  }

  downloadDataUrl(dataUrl, fileName);
  reportSigningEvent("completed");
  pushSigningPreview().catch(() => {});
  setStatus(els.parentStatus, "此瀏覽器不支援直接分享圖片，已產生 PNG，請下載後傳送到通訊軟體。", "error");
}

function reportSigningEvent(eventName) {
  if (!state.monitorId) return;
  fetch(`/api/signing-sessions/${state.monitorId}/${eventName}`, { method: "POST" }).catch(() => {});
}

async function pushSigningPreview() {
  if (!state.monitorId || state.watchMode || pageMode !== "parent") return;
  if (!state.file) return;

  const canvas = await composeDocumentCanvas("signed");
  const previewDataUrl = canvas.toDataURL("image/jpeg", 0.75);
  await fetch(`/api/signing-sessions/${state.monitorId}/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ previewDataUrl }),
  }).catch(() => {});
}

async function buildSignedDocumentForParent() {
  if (!state.file) {
    setStatus(els.parentStatus, "請先貼上或上傳老師傳來的同意書。", "error");
    return;
  }

  if (!Object.keys(state.signatures).length) {
    setStatus(els.parentStatus, "請先套用簽名。", "error");
    return;
  }

  return composeDocumentCanvas("signed");
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("無法產生分享圖片。"));
      }
    }, type);
  });
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

function handlePasteZoneDragOver(event, zone) {
  event.preventDefault();
  zone?.classList.add("active");
}

async function handleDocumentDrop(event, role, zone) {
  event.preventDefault();
  zone?.classList.remove("active");
  const file = extractSupportedFile(event.dataTransfer);
  if (!file) {
    setStatus(getRoleStatusElement(role), "拖曳內容不是可用的圖片或 PDF。", "error");
    return;
  }
  await loadSelectedFile(file, role);
}

async function handleParentPaste(event) {
  await handleDocumentPaste(event, "parent");
}

async function handleDocumentPaste(event, role) {
  const file = extractSupportedFile(event.clipboardData);
  if (file) {
    event.preventDefault();
    await loadSelectedFile(file, role);
    return;
  }

  const text = event.clipboardData?.getData("text/plain")?.trim();
  if (text && text.startsWith("data:image/")) {
    event.preventDefault();
    await loadSelectedFile(dataUrlToFile(text, "pasted-image.png"), role);
    return;
  }

  if (state.mode === role) {
    const message =
      role === "teacher"
        ? "剪貼簿沒有可用的圖片或 PDF。請先複製同意書圖片，或改用上傳檔案。"
        : "剪貼簿沒有可用的圖片或 PDF。請先複製老師提供的同意書圖片，或改用上傳檔案。";
    setStatus(getRoleStatusElement(role), message, "error");
  }
}

function getRoleStatusElement(role) {
  return role === "teacher" ? els.uploadStatus : els.parentStatus;
}

function initParentWatchMode() {
  if (!state.monitorId) return;
  syncParentWatchPreview();
  window.setInterval(syncParentWatchPreview, 2000);
}

async function syncParentWatchPreview() {
  if (!state.monitorId || !state.watchMode) return;

  try {
    const response = await fetch(`/api/signing-sessions/${state.monitorId}`);
    if (!response.ok) return;
    const session = await response.json();
    if (!session.previewDataUrl || session.previewDataUrl === state.lastWatchPreview) return;

    state.lastWatchPreview = session.previewDataUrl;
    state.file = { name: "watch-preview.png", type: "image/png", size: 0, dataUrl: session.previewDataUrl };
    await drawImageSource(session.previewDataUrl);
    normalizeSourceCanvasToSharedLayout();
    renderAll();
  } catch {
    // keep polling
  }
}

function initMonitorPage() {
  const params = new URLSearchParams(location.search);
  const monitorId = params.get("monitor") || "";
  state.monitorId = monitorId;

  if (!monitorId) {
    renderMonitorState({ status: "missing" });
    return;
  }

  pollMonitorState();
  window.setInterval(pollMonitorState, 2000);
}

async function pollMonitorState() {
  if (!state.monitorId) return;

  try {
    const response = await fetch(`/api/signing-sessions/${state.monitorId}`);
    if (!response.ok) {
      renderMonitorState({ status: response.status === 410 ? "expired" : "missing" });
      return;
    }
    renderMonitorState(await response.json());
  } catch {
    renderMonitorState({ status: "offline" });
  }
}

function renderMonitorState(session) {
  if (!els.monitorState) return;

  const statusText = {
    waiting: "等待家長開啟連結",
    opened: "家長已開啟連結",
    signed: "家長已套用簽名",
    completed: "家長已下載或分享完成圖",
    expired: "監控連結已過期",
    missing: "找不到監控資料",
    offline: "暫時無法連線到本機服務",
  };

  els.monitorTitle.textContent = session.title || "簽名狀態監控";
  els.monitorState.textContent = statusText[session.status] || "等待狀態更新";
  els.monitorState.dataset.status = session.status || "";
  els.monitorDetail.textContent = buildMonitorDetail(session);
  els.monitorUpdated.textContent = session.updatedAt ? `最後更新：${formatDateTime(session.updatedAt)}` : "";
}

function buildMonitorDetail(session) {
  if (session.status === "waiting") return "家長尚未打開分享連結。";
  if (session.status === "opened") return "家長已進入簽名頁，尚未套用簽名。";
  if (session.status === "signed") return "家長已套用簽名，等待下載或分享完成圖。";
  if (session.status === "completed") return "家長已完成下載或分享。";
  if (session.status === "expired") return "請重新產生家長端分享連結。";
  if (session.status === "offline") return "請確認本機服務或部署服務仍在執行。";
  return "請從老師端重新產生分享連結。";
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
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
