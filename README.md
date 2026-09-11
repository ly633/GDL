# 一起组队 · 课堂随机分队与评分

上课时导入学生名单，按每队人数随机组队，并为小队记录课堂表现。

网站：https://ly633.github.io/GDL/

## 使用

1. 点击或拖入 Excel 名单，支持 `.xlsx`、`.xls` 和 `.csv`。可以先下载名单模板，也可以粘贴姓名，或使用 18 人示例名单。
2. 选择工作表、起始行、姓名列和可选的学号列，检查预览后确认导入。
3. 默认每队最多 3 人。选择均衡分配或保留尾队，再点击“随机分队”。例如 10 人按 3 人分队，均衡模式为 3、3、2、2 人；保留尾队为 3、3、3、1 人。
4. 每队可以加 1 分、减 1 分，也能输入自定义分数和备注（支持一位小数）。积分榜自动排序，同分并列。支持撤销最近一次计分和清零。
5. 点击“导出”下载包含积分排行、分组明细和计分记录的 Excel。进入投屏模式可以放大课堂看板，按 Esc 退出。
6. “分享”生成当前队伍和积分的只读链接，学生无需登录即可查看。

## 数据保存与分享

- 这是纯静态网站，没有服务器数据库或登录系统。Excel 文件只在浏览器中读取，不上传到 GitHub。
- 名单、分组、积分自动保存到当前浏览器的 localStorage。换设备、换浏览器、隐私模式或清理网站数据后，原记录不会自动恢复。重要记录请导出 Excel。
- “分享结果”将当前姓名、学号和积分编码进链接的 URL 片段（`#result=…`）。拥有该链接的人可以读取它。此链接是快照，后续评分不会自动同步；评分变动后请重新生成链接。
- 分享页为只读，不会覆盖接收者已有的本地课堂。链接超过限制时请导出 Excel；部分聊天软件也可能截断长链接。
- 一个普通网站链接让所有人使用同一套工具，并不让不同设备共享同一个实时课堂。如果需要多人实时同步评分，需要另加后端服务。
- 重分队、替换名单、清零和清空前会请求确认。重新分队会开启新一轮积分。
- 每次导入上限 500 人、10 MB；工作表须在 1000 行和 100 列以内。空姓名跳过，同名保留，重复非空学号会提示修正。
- 随机分配使用 Web Crypto 和 Fisher–Yates 洗牌。每位学生只会出现在一队。

## 本地运行与维护

需要 Node.js 24（或 >=22.13）。

```sh
npm ci
npm run dev
```

```sh
npm test
npm run lint
npm run build
npm start
```

源码使用 React、TypeScript 和 Vite。静态成品在 `dist/`，使用相对资源路径，可挂在 GitHub Pages 子路径，也可放在其他静态主机。部署后无需 Node.js 服务器。不要双击源码的 `index.html`，请使用开发服务器或静态主机。

主要文件：`app/page.tsx`（页面）、`app/globals.css`（样式）、`lib/classroom.ts`（分队/评分/数据校验）、`lib/excel.ts`（表格解析/导出）。

## GitHub Pages

仓库 Settings → Pages → Build and deployment → Source 设为 **GitHub Actions**。代码推送到 `main` 后，`.github/workflows/pages.yml` 自动检查、构建和部署。

使用 `actions/configure-pages@v5`、`actions/upload-pages-artifact@v4` 和 `actions/deploy-pages@v4`，参见 [GitHub Pages 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

Excel 读写使用 [SheetJS CE 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/)，从官方发布地址安装，打包到本站资源。页面运行时不依赖外部 Excel CDN。

可选 WebMCP：支持的浏览器可读取当前队伍，或在尚无分组时随机分队。此接口不影响普通浏览器使用。
