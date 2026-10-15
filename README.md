# 论坛体写作助手

一个离线可用的「论坛体」小说排版工具。用写代码的方式管理楼层、马甲、时间线和导出结果，解决用记事本写论坛体时结构混乱、角色身份记不住、导出后排版全乱的痛点。

## 下载

已打包好的 Windows 版本见 [Releases](https://github.com/godwhycant/forum-writer/releases/latest)：

- `ForumWriter-x.y.z-Setup.exe` —— 安装版（推荐）
- `ForumWriter-x.y.z-Portable.exe` —— 便携版，免安装

下载后即为中文界面，无需额外配置。也可直接克隆本仓库，按下方说明自行运行或打包。

> **v1.1.0**：从「单帖编辑器」升级为「多帖论坛工作台」。新增帖子目录（版主后台）统一总览、用户总览、版块管理、相关帖子互链；每帖写作界面与 v1.0.x 完全一致。旧存档首次打开会自动迁移并另存备份，不会丢数据。
>
> **v1.0.1**：修复「批量回复」在角色词库为空、或选择「全部同一个人」但楼层未指定马甲时静默失效（并可能连带楼层列表渲染异常）的问题。v1.0.0 安装包内是旧代码，建议升级。

## 功能

- **楼层管理**：多楼层 + 楼中楼，拖拽排序，折叠成组
- **角色 / 马甲库**：随机生成昵称、ID、头像、头衔，支持匿名发言
- **楼主标记**：勾选「帖主」后，其所有发言在预览和导出中自动标注「楼主」
- **置顶区**：楼主帖 + 多条公告，可收起、排序、恢复
- **水军批量回复**：一次性添加 N 条相同内容（自动分配合适的随机角色）
- **时间线**：按时间排序或手动排序，新楼层自动按间隔递增时间
- **配图**：本地图片自动压缩为内嵌 dataURL
- **导出**：Markdown / BBCode / 纯文本 / HTML，以及可再导入的 `.json` 存档
- **词库**：名字、称号、头衔等词库可自定义，随存档一起保存

### v1.1.0 新增：多帖容器 + 版主后台

- **一个存档装多帖**：每帖的角色、楼层、词库完全独立，互不影响；顶栏即当前帖子标题
- **版主后台（管理视图）**：点顶栏「🧰 管理」进入
  - **帖子目录**：按 置顶 → 主帖 → 更新时间 排序，可直接改标题 / 版块 / 标签 / 状态、复制、锁定、删除、设为「主帖」、单独导出某帖
  - **相关帖子**：手动勾选互相引用的帖子（如主线 ↔ 番外），目录与预览区都会显示链接
  - **用户总览**：跨帖汇总所有账号，同一 ID 合并显示发帖 / 楼层 / 回复数；**匿名角色在此也显示真实昵称**（版主视角）；可为每个账号登记 版主标签 / 备注 / 警告 / 封禁
  - **版块管理**：增删改版块；删除版块时其下帖子自动归入第一个版块
- **启动视图可选**：「设置 → 启动时进入」选择打开软件时进入写作界面（默认）还是版主后台
- **锁定帖子**：锁定后写作区变只读，避免误改已完成的稿子
- **从后台进入写作**：顶部出现「← 返回管理」返回条
- **预览区增强**：显示当前帖的版块、标签、精华 / 锁定 / 状态标记与相关帖子

## 从 v1.0.x 升级

1.1.0 沿用同一个 `localStorage` key（`forum-writer-project-v1`），因此**旧存档无需手动导入**：

- 首次用 1.1.0 打开旧存档时，会自动转成多帖容器的第一篇帖子；
- 转换前的原始 JSON 会另存到 `forum-writer-backup-v1`，在「? → 关于」中可看到提示；
- 若需回退旧版：安装 v1.0.1，在开发者工具控制台执行
  `copy(localStorage.getItem('forum-writer-backup-v1'))` 取出旧存档 JSON，再粘贴进「导入」即可（或直接把它写回 `forum-writer-project-v1`）。

> 建议升级前先「导出 ▾ → 存档 (.json)」留一份手头备份，双保险。

## 快速开始（开发）

纯前端项目，无构建步骤。

```bash
# 方式一：直接用浏览器打开
start index.html

# 方式二：用 Electron 跑桌面版
npm install
npm start
```

## 打包桌面版

```bash
npm install

# 免安装文件夹版（最快，用于本地调试）
node node_modules/electron-builder/out/cli/cli.js --win --dir   # -> dist/win-unpacked

# 便携单文件版
#   在 package.json 的 build.win.target 里把 target 改成 "portable" 再执行：
node node_modules/electron-builder/out/cli/cli.js --win

# 安装版（NSIS）
#   在 package.json 的 build.win.target 里把 target 改成 "nsis" 再执行：
node node_modules/electron-builder/out/cli/cli.js --win         # -> dist/*安装包.exe
```

产物在 `dist/`（已在 `.gitignore` 中忽略）。发布到 GitHub Releases 时，请将产物重命名为纯 ASCII 文件名（如 `ForumWriter-1.1.0-Setup.exe`）——中文文件名在 Release 资产上传时会被服务端截断。

### 图标

图标源文件是 `build/icon.svg`，多尺寸 PNG 由 Python + Pillow 生成：

```bash
python -c "from PIL import Image; src=Image.open('build/icon.png'); [src.resize((s,s),Image.LANCZOS).save(f'build/icon-{s}.png') for s in (16,24,32,48,64,128,256)]"
python build/make-icon.py   # -> build/icon.ico
```

## 数据存储

作品数据保存在本机 `localStorage`（key：`forum-writer-project-v1`，多帖容器格式）。**只有导出的 `.json` 文件是官方备份方式**，其他格式（md / bbcode / txt / html）为纯输出，不能再导入。「导出 ▾ → 存档 (.json)」导出整个容器，「仅当前帖子 (.json)」只导出当前帖。

从 v1.0.x 迁移时，旧存档的原始 JSON 会保留在 `forum-writer-backup-v1`，不会被覆盖。

## 技术栈

原生 JavaScript（无框架、无构建、无依赖）+ Electron 外壳。

## 已知限制

- 安装包 / 便携版均**未数字签名**，首次运行 Windows SmartScreen 可能提示「未知发布者」，点「仍要运行」即可。
- 便携版每次启动需解压约 70 MB 到临时目录，比安装版慢约 2–4 秒。
