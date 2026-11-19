> **2026-11-20 已搬家，這個倉庫不要再改。** 正本改到 `Borrysu/borrysu.github.io` 的 `current/`（本機 `~/Developer/borrysu.github.io/current`，網址 https://borrysu.github.io/current/ ）。這裡的 index.html、404.html 只是轉址頁，sw.js 只會註銷自己。退回：`git revert` 轉址 commit，或看 tag `before-redirect-20261120`。

# 通告板（原機會雷達）前端

靜態網頁，沒有建置步驟。`index.html` 加 `css/app.css` 加 `js/*.js`（ES modules，不擋畫面）。

## 檔案
- `js/adapter.js`：唯一知道後端長相的檔案。設定、金鑰處理、RPC 呼叫、Realtime、欄位正規化。
- `js/mock.js`：沒有金鑰時的示範資料與假動作，以及偵錯用的 `?mock=` 參數。有金鑰時不會載入。
- `js/app.js`：狀態、畫面、事件。
- `js/util.js`：時間格式、倒數文字、中文斷行、金額拆分。
- `sw.js`：只快取同網域畫面檔，讓離線時打得開。API 請求不經過它。
- `manifest.webmanifest`、`icons/`：加到 iPhone 主畫面用。

## 金鑰
用 `網址?k=金鑰` 開（也收舊的 `#k=金鑰`）。金鑰存進 localStorage 的 `opp_key`，**並留在網址列上（#k= 會改成 ?k=）**，和記帳面板一樣：iPhone 加到主畫面時網址帶著金鑰，獨立 App 第一次開也有金鑰。
金鑰來源順序：?k=、#k=、localStorage。貼上金鑰按鈕會連網址一起換掉。manifest 刻意不寫 start_url，iOS 才會用加入當下的網址。
`sw.js` 的 CACHE 名稱每次改版要換（網路優先，所以不換也不會卡舊版，但舊快取會留著）。
金鑰不會寫在任何檔案裡。`SUPABASE_ANON_KEY` 是公開的 publishable key。
