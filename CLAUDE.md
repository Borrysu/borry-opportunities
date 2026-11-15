# 給 Claude：怎麼改「機會雷達」面板

這是 Borry 個人的機會雷達（原名機會面板），網址 https://borrysu.github.io/borry-opportunities/ 。
個人案，用個人帳號的 `claude B` 來改。回覆 Borry 一律台灣繁體中文。

## 你可以改的
- 這個 repo 的所有前端檔：`index.html`、`css/app.css`、`js/*.js`、`manifest.webmanifest`、`icons/`、`sw.js`。
- 靜態網頁，沒有建置步驟。改完 push 到 `main`，GitHub Pages 大約 1 分鐘後上線。

## 不能碰的
- 不能把金鑰寫進任何檔案或 commit。金鑰只走網址 `?k=` 和 localStorage `opp_key`。
- 不要改資料庫（Supabase kakeibo 專案的 `opp_` 表與 RPC）。後端要改請先跟 Borry 說，由通通（Tom Tom）處理。
- `js/adapter.js` 是唯一碰後端的檔案，欄位名稱與 RPC 名稱不要自己改。

## 改版流程
1. 在 Mac 本機 `~/Developer/borry-opportunities` 改（已經 clone 好）。先 `git pull`。
2. 本機看效果：`python3 -m http.server 8811` 後開 `http://localhost:8811/?mock=1`（示範資料，不用金鑰，不會動到真資料）。
3. 每次改版把 `sw.js` 裡的 `CACHE` 名稱換一個新的版本號。
4. `git add -A && git commit -m "說明這次改了什麼" && git push`。
5. 驗收：等 1 分鐘，開網址確認改動出現，手機寬度（390px）也看一次。

## 目前的手機行為（不要改壞）
- 五個籃子分頁，手指左右滑切到隔壁籃子（`js/app.js` 的 touchstart / touchend）。
- 待決區在手機直向是右下浮動按鈕 `#hpill`，籃子鋪到螢幕底；橫向和寬螢幕改用頂列 `#holdbtn`。
- 加到 iPhone 主畫面要帶金鑰網址，所以 manifest 刻意不寫 `start_url`。

詳細架構看 `README.md`。
