# 几何深度学习 · 分组与每周成绩

网站：[https://ly633.github.io/GDL/](https://ly633.github.io/GDL/)

导入 Excel 名单、随机组队，按小队评分后，把队伍总分登记为每位成员本次作业的个人成绩。学生打开同一网址，查看教师最后发布的分组和全部每周成绩。

## 教师首次登录

1. 打开网站，点击右上角“教师登录”。仅允许 GitHub 账号 **ly633** 进入管理。
2. 登录该账号，在 [GitHub 创建 Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)。Resource owner 选择 ly633；Repository access 选择 **Only select repositories → GDL**；Repository permissions 中设置 **Contents → Read and write**。选择合适的有效期后生成令牌。
3. 将令牌粘贴到网站的登录框。令牌只在当前页面内存中使用；不会保存在 localStorage、网址、成绩文件或源码中，刷新/关闭页面后需要重新登录。请勿把令牌分享给学生。
4. 第一次登录会恢复当前浏览器原有的名单与成绩，作为本机草稿。换设备登录时，会载入最后发布的版本；若本机草稿的版本与线上不同，会先让你选择继续草稿，还是用线上版本替换草稿。
5. 完成编辑，点击“发布”并确认公开范围。页面先显示“已提交，正在部署”，确认公开网站已加载新版本后才显示“发布完成”。学生随后刷新同一网址即可看到更新。

令牌过期、权限不足或线上版本发生变化时，页面会提示重新登录，不会自动覆盖新版本。GitHub 的账号权限与令牌权限共同决定是否能写入仓库；公开仓库并不代表任何人都有写权限。[GitHub 令牌说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

## 组队与评分

1. 登录后点击或拖入名单，支持 `.xlsx`、`.xls` 和 `.csv`。可下载名单模板、粘贴姓名，也可使用 18 人示例名单。
2. 选择工作表、起始行、姓名列和可选的学号列，检查预览后确认导入。
3. 默认每队最多 3 人。10 人按 3 人分队，均衡模式为 3、3、2、2 人；保留尾队为 3、3、3、1 人。
4. 选择“当前评分作业”，点击小队评分按钮，填写作业总分，支持一位小数，也可以快速加减 1 分。
5. 小队总分 85 时，各成员均记 85 分；改为 90 后，成员本次作业成绩均更新为 90，不会累加或除以人数。
6. “个人成绩表”每行一位学生、每列一次作业。`—` 表示未评分，`0` 表示已评 0 分；平均分只统计已评分作业。
7. 下周点击“添加作业”，新作业沿用分组，成绩为空，也可重新随机分队。往周的分组和成绩独立保留。
8. 重新分队保留个人成绩，重置当前作业队伍分数；新小队评分时更新其成员本次作业成绩。撤销同时恢复成员原成绩；清零仅清除所选作业。
9. “导出”生成所有周的个人成绩表、当前队伍排行、各周分组明细和本机计分记录。“投屏”放大课堂看板，Esc 退出。
10. “分享”复制固定网站地址。学生无需账号，可切换查看不同作业和导出已发布成绩，不能修改线上内容。

替换名单或清空课堂会清除草稿中的全部周成绩，操作前会确认。每周上课只需添加作业，不必重导名单。

## 数据与发布机制

- 默认访问只读取本站 `classroom.json`，不会加载访问者的本机草稿。首次部署的文件为空，需要教师登录后发布一次实际课堂。
- Excel 原文件仅在浏览器解析。点击发布时，公开的是姓名、学号、全部周的分组和个人成绩；原始文件名、计分备注、撤销历史不上传。公开数据也会留存在仓库提交历史中。
- 教师草稿保存于当前浏览器。清理网站数据会丢失尚未发布的修改，请按需导出 Excel。已发布成绩可从线上恢复，计分备注和撤销记录仅保存在编辑设备。
- 教师通过 GitHub API 验证身份与仓库权限；发布使用 [Contents API](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28) 更新固定文件 `public/classroom.json`。真正的写权限由 GitHub 校验，不依赖隐藏按钮或前端密码。
- 每次提交携带登录时读取的文件 SHA，防止旧设备覆盖较新的发布。遇到冲突、网络结果不确定或权限错误时，保留草稿并要求重新核对版本，不自动重试提交。
- 更新会触发现有 GitHub Actions 部署。网页定时检查公开文件的发布标识，确认一致才报告完成；超过约三分钟仍未确认时显示待确认状态，可打开“部署状态”查看。学生刷新后读取最新公开版本，不是实时协同编辑。
- 旧 `#result=…` 分享链接仍作为历史只读快照打开，可点击“查看最新课堂”。旧本机数据在教师登录时自动迁移为第一周作业。
- 支持最多 500 人、100 次作业。每次导入不超过 10 MB，工作表限 1000 行、100 列；空姓名跳过，同名保留，重复非空学号需修正。每周本机计分记录最多 2000 条。
- 单次公开数据限定 900,000 字节，超过时会在提交前提示拆分课堂或导出 Excel。
- 随机分配使用 Web Crypto 和 Fisher–Yates 洗牌，每位学生恰好属于一队。

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

源码使用 React、TypeScript、Vite。静态成品在 `dist/`，使用相对资源路径，可部署到 GitHub Pages 子路径。部署后不需要 Node.js 服务器。

主要文件：

- `app/app.tsx`：公开数据加载、教师登录、草稿选择与发布状态。
- `app/page.tsx`：分队、评分与成绩表界面。
- `app/globals.css`：样式。
- `lib/publishing.ts`：数据清理、GitHub 身份验证和版本保护。
- `lib/classroom.ts`：分队、每周评分、数据校验。
- `lib/excel.ts`：Excel 解析与导出。
- `public/classroom.json`：已发布课堂。教师发布会更新它；后续维护代码时应先同步远端，保留最新数据。

## GitHub Pages

Settings → Pages → Build and deployment → Source 设为 **GitHub Actions**。每次推送 `main`，包含网页内发布课堂的提交，均由 `.github/workflows/pages.yml` 自动测试、构建并部署。

使用 `actions/configure-pages@v5`、`actions/upload-pages-artifact@v4` 和 `actions/deploy-pages@v4`，参见 [GitHub Pages 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

Excel 读写使用 [SheetJS CE 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/)，从官方发布地址安装并打包，运行时不依赖外部 Excel CDN。

可选 WebMCP：支持的浏览器可读取当前队伍；仅教师编辑模式允许在尚无分组时随机分队。
