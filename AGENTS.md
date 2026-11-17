# 機會雷達：給 Codex（小光）、AGY、Cursor、Claude（大器）的改版入口

Borry 2026-11-17：「你讓 GPT AGY 都有權利去改我機會雷達，然後也要知道用什麼工具並且怎麼改。還有 cursor」。
所以這四家都可以改這個面板。規則與現況以同資料夾 `CLAUDE.md` 為正本（名字是 Claude 的，但內容是大家共用的規則），**動手前完整讀一遍**，本檔只補「用什麼工具、怎麼改」。

- 面板：https://borrysu.github.io/borry-opportunities/ （Borry 個人的機會雷達，靜態網頁＋Supabase 專案 kakeibo）
- 本機正本：`/Users/borry/Developer/borry-opportunities`（公開 repo `Borrysu/borry-opportunities`，**任何金鑰都不准寫進來**）
- 公司版「好咖皮條客」在公司電腦，不歸這裡。

## 工具（都在 `tools/`，任何一家用 bash 就能跑）

| 要做什麼 | 用什麼 |
|---|---|
| 讀或改案子資料（加卡、改內容、放連結、結案、掃描單…） | `tools/rpc.sh <函式> '<JSON>'`，金鑰自動帶入（角色「AI協作」，沒有管理員權限，不能徹底刪除） |
| 本機看畫面 | `tools/preview.sh`，開 `http://localhost:8811/?mock=1`、`?mock=xss`、`?mock=longname` |
| 改了 css／js 之後換版號 | `tools/bump.sh`（?vN 與 sw.js 快取名一起加一） |
| 推上線並等 GitHub Pages 換新 | `tools/publish.sh "這次改了什麼"`（會先 pull、列出要換的檔，再推） |
| 改資料庫結構（加欄位、改函式） | `tools/sql.sh 檔案.sql`。需要 `~/.config/borry-opportunities/supabase-pat`；沒有就交給大器（Claude），它有 Supabase 連接器 |

函式清單與用法：`CLAUDE.md` 第 12～16、21 條，以及 `js/adapter.js` 開頭註解。

## 怎麼改

1. **只改資料**（案子內容、連結、進度、提醒）：用 `tools/rpc.sh`，**不用改版**（CLAUDE.md 第 21 條）。
2. **改畫面或功能**：改 `index.html`、`css/app.css`、`js/*.js` → `tools/bump.sh` → `tools/preview.sh` 在 390 寬看 `?mock=1`、`?mock=xss`（`window.__xss` 要一直是空的）、`?mock=longname`（標題不能被擠成直排）→ 改 `CLAUDE.md` 的規則 → `tools/publish.sh "說明"` → 開線上網址再看一次。
3. **改資料庫結構**：先用 `tools/sql.sh -c "select pg_get_functiondef('public.opp_xxx'::regproc)"` 存原定義到 `~/Claude-Projects/Tools/opportunity-folder-job/backup/`，只加不刪；改完用測試資料驗，驗完刪掉測試資料。

## 不准做

- 金鑰、權杖寫進 repo 或貼進對話（repo 是公開的）。
- 刪資料庫裡的卡或資料表、改別人的金鑰權限。徹底刪除只有 Borry 本人能做。
- 搶滑鼠、把 App 叫到前景；一律背景跑（大器 AGENTS.md「CLI 背景執行」）。
- 同時有別的 AI 在改：推之前 `git pull`，衝突就停下回報，不要強推（`--force` 禁用）。

改完在 `/Users/borry/Claude projects/handoff/交接帳.md` 檔尾追加一行（誰、改了什麼、commit）。這是個人案：Codex 用 `codex B`、AGY 用 `agy B`、Cursor 用本人帳號、Claude 用 `claude B`。
