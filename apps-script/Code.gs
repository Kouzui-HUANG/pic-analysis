/**
 * PicAnalysis — GMI Cloud relay (Google Apps Script web app)
 *
 * 為什麼需要：
 *   GMI Cloud 的 request-queue API 不發送 CORS 標頭，瀏覽器無法直接呼叫；
 *   GitHub Pages 是純靜態託管，無法跑 serve.py 提供本地代理。
 *   此 Apps Script 部署為 Web App 後，作為前端 ↔ GMI 之間的中繼，
 *   由 Google 伺服器代為呼叫 GMI，回傳結果給 GitHub Pages 上的前端。
 *
 * 部署步驟：
 *   1. 開啟 https://script.google.com → 新增專案
 *   2. 把這份 Code.gs 整段貼到 Apps Script 編輯器
 *   3. 部署 → 新增部署作業 → 類型選「網頁應用程式」
 *      - 執行身分：「我」(your account)
 *      - 存取權：「任何人」(Anyone)
 *   4. 部署後複製 /exec 結尾的網址
 *   5. 把網址貼到 js/main.js 中的 GMI_RELAY_URL 常數，重新 push
 *      或在瀏覽器 Console 執行：
 *        localStorage.setItem('gmi_relay_url', '<your-exec-url>')
 *
 * 通訊協定：
 *   全部使用 POST + Content-Type: text/plain（避開 CORS preflight）
 *   Body 是 JSON 字串：
 *     { "action": "submit",      "apiKey": "...", "payload": {...} }
 *     { "action": "poll",        "apiKey": "...", "requestId": "..." }
 *     { "action": "upload",      "apiKey": "...", "fileType": "png", "imageBase64": "..." }
 *     { "action": "fetch_image", "url": "https://storage.googleapis.com/..." }
 *
 *   成功：回傳 GMI 原始 JSON（fetch_image 與 upload 例外，見下）
 *   失敗：{ "_error": true, "_status": <upstream code>, "_message": "..." }
 *
 * 安全性：
 *   - API Key 由前端在 body 中夾帶，本 Script 不儲存任何金鑰
 *   - fetch_image 只允許 storage.googleapis.com 起頭的網址，
 *     避免被當成開放代理
 */

var GMI_BASE = 'https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey';
var STORAGE_PREFIX = 'https://storage.googleapis.com/';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'submit':       return handleSubmit(body);
      case 'poll':         return handlePoll(body);
      case 'upload':       return handleUpload(body);
      case 'fetch_image':  return handleFetchImage(body);
      default:             return errorResponse(400, 'Unknown action: ' + body.action);
    }
  } catch (err) {
    return errorResponse(500, 'Relay error: ' + (err && err.message || String(err)));
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', service: 'pic-analysis-gmi-relay' });
}

function handleSubmit(body) {
  if (!body.apiKey)  return errorResponse(400, 'Missing apiKey');
  if (!body.payload) return errorResponse(400, 'Missing payload');

  var response = UrlFetchApp.fetch(GMI_BASE + '/requests', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + body.apiKey },
    payload: JSON.stringify(body.payload),
    muteHttpExceptions: true
  });
  return passThrough(response);
}

function handlePoll(body) {
  if (!body.apiKey)    return errorResponse(400, 'Missing apiKey');
  if (!body.requestId) return errorResponse(400, 'Missing requestId');

  var url = GMI_BASE + '/requests/' + encodeURIComponent(body.requestId);
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + body.apiKey },
    muteHttpExceptions: true
  });
  return passThrough(response);
}

function handleUpload(body) {
  if (!body.apiKey)      return errorResponse(400, 'Missing apiKey');
  if (!body.fileType)    return errorResponse(400, 'Missing fileType');
  if (!body.imageBase64) return errorResponse(400, 'Missing imageBase64');

  // Step 1: ask GMI for a signed upload URL
  var urlResp = UrlFetchApp.fetch(GMI_BASE + '/upload-url', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + body.apiKey },
    payload: JSON.stringify({ file_type: body.fileType }),
    muteHttpExceptions: true
  });
  var urlCode = urlResp.getResponseCode();
  if (urlCode < 200 || urlCode >= 300) {
    return errorResponse(urlCode, 'Get upload URL failed: ' + urlResp.getContentText().slice(0, 300));
  }
  var urlData;
  try {
    urlData = JSON.parse(urlResp.getContentText());
  } catch (e) {
    return errorResponse(500, 'Upload URL response not JSON');
  }
  if (!urlData.upload_url || !urlData.public_url) {
    return errorResponse(500, 'Upload URL response missing fields');
  }

  // Step 2: PUT image bytes to the signed URL
  var bytes = Utilities.base64Decode(body.imageBase64);
  var putResp = UrlFetchApp.fetch(urlData.upload_url, {
    method: 'put',
    contentType: 'image/' + body.fileType,
    payload: bytes,
    muteHttpExceptions: true
  });
  var putCode = putResp.getResponseCode();
  if (putCode < 200 || putCode >= 300) {
    return errorResponse(putCode, 'Upload PUT failed: ' + putResp.getContentText().slice(0, 300));
  }

  return jsonResponse({ public_url: urlData.public_url });
}

function handleFetchImage(body) {
  if (!body.url) return errorResponse(400, 'Missing url');

  // Lock the proxy to GMI's signed URLs only — prevents abuse as
  // a general-purpose open proxy.
  if (body.url.indexOf(STORAGE_PREFIX) !== 0) {
    return errorResponse(400, 'Only storage.googleapis.com URLs are allowed');
  }

  var response = UrlFetchApp.fetch(body.url, { muteHttpExceptions: true });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    return errorResponse(code, 'Image fetch failed: ' + response.getContentText().slice(0, 200));
  }

  var blob = response.getBlob();
  return jsonResponse({
    data: Utilities.base64Encode(blob.getBytes()),
    mimeType: blob.getContentType()
  });
}

function passThrough(response) {
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code < 200 || code >= 300) {
    var msg = text;
    try {
      var parsed = JSON.parse(text);
      msg = parsed.message || parsed.error || text;
    } catch (e) { /* keep raw */ }
    return errorResponse(code, String(msg));
  }

  // Success: return upstream JSON verbatim
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(status, message) {
  return ContentService.createTextOutput(JSON.stringify({
    _error: true,
    _status: status,
    _message: message
  })).setMimeType(ContentService.MimeType.JSON);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
