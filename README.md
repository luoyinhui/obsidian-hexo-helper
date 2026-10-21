# obsidian-hexo-helper

在 Obsidian 里直接写 Hexo 博客的辅助插件：自动生成 Front-matter、保存图片、识别并跳转 Hexo 永久链接，再配合一个 Hexo 脚本解决 Obsidian 与 Hexo 的路径差异。

> 适用于「Obsidian 仓库根目录 = Hexo 博客根目录」的用法。

## 功能

### 新建文章自动生成 Front-matter

在 `source/_posts/` 或 `source/_drafts/` 下新建 `.md` 时自动处理：

- 已有 Front-matter：只补 `abbrlink`
- 没有 Front-matter：生成完整模板
- `abbrlink` 由「文件名 + 当前时间」经 CRC32 计算，取十六进制字符串

```yaml
---
title: 文章标题
date: 2026-02-20 23:34:50
tags:
categories:
description:
swiper_index:
abbrlink: 97c40ef2
---
```

### 图片粘贴 / 拖拽

- 仅对 `source/_posts/`、`source/_drafts/` 下的 Markdown 生效
- 图片保存到 `source/img/<abbrlink>/<abbrlink>-<序号>.<扩展名>`
- 文件名冲突时自动递增序号，不会覆盖已有图片
- 在文章中插入相对链接，例如 `![<abbrlink>-1.png](../img/<abbrlink>/<abbrlink>-1.png)`，Obsidian 可直接预览

### 跨文章复制图片

从另一篇 Hexo 文章复制一段包含本地图片的 Markdown，粘贴到当前文章时，插件会把图片复制到当前文章的图片目录并改写链接。

仅当剪贴板内容与最近一次站内复制一致、且距离复制不超过 5 分钟时触发，避免误处理外部内容。

### Hexo 链接识别与跳转

- 支持 `/posts/<abbrlink>/`、`/posts/<abbrlink>/#<锚点>` 格式
- 点击后打开对应文章，并定位到标题
- 锚点按 Hexo 的 slug 规则匹配：小写、空格与特殊字符转 `-`、中文保留、重名标题依次追加 `-2`、`-3`

### 右键复制 Hexo 链接

- 编辑器右键：`Copy Hexo Link`
- 光标位于标题行时，复制带锚点的链接
- 文件列表右键：同样可以复制
- 输出格式：`[标题](/posts/<abbrlink>/#<锚点>)`
- 需要文章 Front-matter 中存在 `abbrlink`

### 草稿 / 发布 / 私有

文件列表右键：

- `source/_drafts/` 下的文章 → `hexo_发布至博客`：移动到 `source/_posts/`
- `source/_posts/` 下的文章 → `hexo_收归私有`：移动到 `source/_drafts/private/`
- 目标文件已存在时中止并提示
- 图片目录会随文章一起移动，文章内的 `../img/` 相对链接保持不变

## 路径约定

```text
博客根目录/
├── .obsidian/plugins/obsidian-hexo-helper/
├── source/
│   ├── _posts/                  # 已发布文章
│   ├── _drafts/                 # 草稿
│   │   └── private/             # 私有草稿
│   └── img/                     # 普通文章的图片
│       └── <abbrlink>/
│           ├── <abbrlink>-1.png
│           └── <abbrlink>-2.jpg
└── scripts/
    └── fix-hexo-compat.js
```

- 文章建议直接放在 `_posts/`、`_drafts/` 一级目录下，插件按「文章所在目录的上一级 `img/`」计算图片位置
- 私有草稿的图片位于 `source/_drafts/img/<abbrlink>/`
- 这些路径写死在 `main.js` 顶部常量中，调整目录结构时需要同步修改

## 安装

### 1. 安装 Obsidian 插件

1. 克隆或下载本仓库
2. 把仓库里的 `obsidian-hexo-helper/` 文件夹复制到博客仓库的 `.obsidian/plugins/` 下，最终路径应为 `.obsidian/plugins/obsidian-hexo-helper/main.js`
3. 重启 Obsidian，在「设置 → 第三方插件」中关闭安全模式并启用 `Hexo Helper Enhanced`（插件 id：`hexo-helper-enhanced`）
4. 确认 Obsidian 打开的仓库根目录就是 Hexo 博客根目录（能看到 `source/_posts`）

### 2. 配置 Hexo 兼容脚本（必需）

把 `scripts/fix-hexo-compat.js` 放到博客根目录的 `scripts/` 文件夹，Hexo 会自动加载。它处理三件事：

- **图片路径**：`../img/`、`../../img/` → `/img/`，避免网站上的相对路径 404
- **标题锚点**：`/posts/<abbrlink>/#中文%20标题` → Hexo 实际生成的 slug 锚点
- **PDF**：`![[xxx.pdf]]` → PDF.js iframe

PDF 部分默认使用 `/js/pdfjs/web/viewer.html?file=/pdf/<文件名>`，需要站点存在对应的 PDF.js 文件和 `source/pdf/` 目录；路径不一致时请修改脚本。

### 3. 迁移旧文章（可选，一次性）

把 `scripts/convert_to_relative.js` 放到博客根目录的 `scripts/` 下，然后在博客根目录执行：

```bash
node scripts/convert_to_relative.js
```

脚本会把旧文章中的 `![...](/img/...)` 批量改成 `![...](../img/...)`。

执行完建议从 `scripts/` 移走，避免 Hexo 每次启动都运行它。运行前先提交或备份文章。

## 使用

1. **新建文章**：在 `_posts` 或 `_drafts` 新建 Markdown，Front-matter 自动生成
2. **插入图片**：直接粘贴截图或拖入图片文件
3. **复用内容**：从其他文章复制带图片的 Markdown，粘贴后图片自动转存
4. **复制链接**：编辑器或文件列表右键 `Copy Hexo Link`
5. **跳转**：在 Obsidian 中点击 `/posts/...` 链接
6. **发布 / 撤回**：文件列表右键 `hexo_发布至博客` 或 `hexo_收归私有`

## 注意事项

- 旧文章如果没有 `abbrlink`，粘贴图片会被跳过并提示；需要手动补一个唯一值，`Copy Hexo Link` 也依赖它
- `abbrlink` 需全局唯一，插件按 abbrlink 定位文章
- 插件没有设置界面，路径常量集中在 `main.js` 顶部
- 图片转存只处理标准 Markdown `![alt](path)`，不处理 `![[...]]` 嵌入语法
- 插件对 `source/_posts`、`source/_drafts` 下所有层级的 Markdown 生效，但目录层级会影响图片位置计算，建议文章放在一级目录

## 文件结构

```text
obsidian-hexo-helper/          # 仓库根目录
├── obsidian-hexo-helper/      # 插件本体
│   ├── main.js
│   └── manifest.json
├── scripts/
│   ├── fix-hexo-compat.js     # Hexo 构建兼容脚本
│   └── convert_to_relative.js # 旧文章路径迁移脚本
└── README.md
```

## 兼容性

- Obsidian ≥ 0.15.0
- Hexo：使用标准 `before_post_render` Filter API，无需修改主题
- 桌面端与移动端均可加载；剪贴板图片和右键菜单的实际行为取决于 Obsidian 客户端实现
