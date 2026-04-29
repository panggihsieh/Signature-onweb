# Signature-onweb 線上補簽同意書

Signature-onweb 是一個讓老師建立同意書、設定家長簽名欄，並讓家長透過連結在手機或電腦上手寫補簽的 web app。

第一版重點是「不需要登入、跨裝置、暫存 Google Drive、完成後自動清除」。老師建立一份同意書後，系統會產生一位家長專用連結；家長開啟連結後可直接手寫簽名，並下載包含「同意書 + 簽名」的 PNG 圖片。

## 功能

- 老師端可上傳圖片或 PDF 同意書。
- 上傳檔案大小限制為 5MB。
- PDF 第一版使用第 1 頁作為簽名底圖。
- 老師可新增、移動、縮放簽名欄。
- 簽名欄預設文字為「家長簽名」。
- 老師可下載空白簽名欄預覽圖。
- 老師可產生一位家長專用連結。
- 家長不需要登入即可開啟連結。
- 家長可在手機觸控手寫簽名。
- 家長可下載包含同意書與簽名的 PNG 完成圖。
- 完成簽名後，系統會清除暫存案件。
- 未完成案件預設 4 小時後自動清除。

## 架構

```text
老師瀏覽器
  -> Node.js 後端
  -> Google Drive 暫存資料夾
  -> 家長連結
  -> 家長瀏覽器
  -> 下載完成 PNG
```

目前後端使用 Node.js 內建 HTTP server，不需要額外安裝 npm 套件。

Google Drive 寫入支援兩種模式：

- `oauth`：建議給個人 Google Drive 使用。後端使用系統設計者的 OAuth refresh token 寫入指定 Drive 資料夾。
- `service_account`：適合 Google Workspace Shared Drive。一般個人 My Drive 可能會遇到 Service Account 沒有儲存空間額度的限制。

若沒有設定 Google Drive 參數，系統會改用本機 `.tmp/` 暫存，方便開發測試。

## 本機啟動

```bash
node server.js
```

開啟：

```text
http://localhost:3000
```

語法檢查：

```bash
node --check server.js
node --check app.js
node --check scripts/google-oauth-token.js
```

## GitHub Actions

本專案已加入兩個 workflow：

- `CI`：push、PR 或手動執行時檢查 JavaScript 語法，並確認 `.env` 沒有被提交。
- `Windows Package`：手動執行或推送 `v*` tag 時，產生 Windows portable ZIP。ZIP 內含啟動用 `start-signature-onweb.cmd`，不包含 `.env` 或任何 secrets。

Windows portable ZIP 仍需要使用者在本機補上 `.env`，或部署時改用平台 Secrets。

## 遠端部署

家長手機在異地使用時，不能使用 `localhost:3000`，必須部署到公開網址。

本專案已提供：

- `Dockerfile`：可部署到支援 Docker 的平台。
- `render.yaml`：可匯入 Render 建立 Web Service。

部署到 Render 時，請在 Render Environment Variables 設定正式 secrets：

```env
GOOGLE_AUTH_MODE=oauth
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_DRIVE_TEMP_FOLDER_ID=
TEMP_CASE_TTL_HOURS=4
MAX_UPLOAD_SIZE_MB=5
```

部署完成後，老師與家長都要使用 Render 提供的公開網址。

## Windows exe

本專案提供 Windows 啟動器 exe。它會在本機啟動 `server.js`，並自動開啟 `http://localhost:3000`。

建立 Windows ZIP：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows-exe.ps1
```

輸出位置：

```text
dist/Signature-onweb-windows.zip
```

ZIP 內包含：

- `Signature-onweb.exe`
- app 前端檔案
- Node 後端檔案
- `.env.example`

注意：ZIP 不會包含 `.env`。如果要寫入 Google Drive，請在解壓縮後自行建立 `.env`。

## 環境變數

請複製 `.env.example` 成 `.env`，再填入本機或部署平台的 secrets。

```env
GOOGLE_AUTH_MODE=oauth
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_DRIVE_TEMP_FOLDER_ID=
TEMP_CASE_TTL_HOURS=4
MAX_UPLOAD_SIZE_MB=5
PORT=3000
```

公開 GitHub 時只能提交 `.env.example`，不能提交 `.env`、OAuth secret、refresh token 或 private key。

## 取得 OAuth Refresh Token

個人 Google Drive 建議使用 `oauth` 模式。

1. 到 Google Cloud Console 的 APIs & Services > Credentials。
2. 建立 OAuth client ID，類型選 Desktop app。
3. 將 client ID 與 client secret 填入本機 `.env`。
4. 執行：

```bash
node scripts/google-oauth-token.js
```

5. 打開工具輸出的授權網址。
6. 授權後複製網址中的 `code`。
7. 執行：

```bash
node scripts/google-oauth-token.js YOUR_CODE
```

8. 將輸出的 `GOOGLE_OAUTH_REFRESH_TOKEN` 填入 `.env` 或部署平台 Secrets。

## 安全原則

- `.env` 已被 `.gitignore` 忽略。
- Google OAuth secret、refresh token、Service Account private key 不得提交到 GitHub。
- 家長簽名與完成圖片不長期保存。
- 暫存檔案完成後刪除，未完成則預設 4 小時後清除。
- 一份家長連結只對應一位家長。

## 發布後必須修改

<div style="background:#000;color:#fff;padding:16px;border-radius:8px;">

以下項目在 GitHub 發布或部署到正式網址後必須檢查與修改：

1. 不要把 `.env` 上傳到 GitHub，只能上傳 `.env.example`。
2. 將正式環境的 secrets 設定在部署平台，例如 Render、Railway 或 Cloud Run 的 Environment Variables。
3. 正式部署前建議重新產生 OAuth client secret 與 refresh token，避免使用曾在測試過程中曝光過的舊值。
4. 將 `GOOGLE_DRIVE_TEMP_FOLDER_ID` 改成正式使用的 Google Drive 暫存資料夾 ID。
5. 確認部署平台的公開網址可被家長手機開啟，不能使用 `localhost:3000` 給家長。
6. 若部署網址改變，請確認老師產生的家長連結使用正式網域。
7. 確認 Google Cloud OAuth 測試使用者或發布狀態符合實際使用情境。
8. 若要開放給非測試使用者長期使用，需依 Google OAuth 規則設定發布狀態與必要驗證。

</div>

## 驗收標準

- 老師可上傳 5MB 以內的圖片或 PDF。
- 老師可拖曳並縮放簽名欄。
- 老師可下載空白簽名欄預覽圖。
- 老師可產生家長專用連結。
- 家長可在不同手機或電腦開啟連結。
- 家長可手寫簽名並套用到文件。
- 家長可下載 PNG 完成圖。
- Google Drive 暫存檔可成功寫入、讀取與刪除。
