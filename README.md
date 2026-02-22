### 1. 目标：
- 实现 Obsidian 内编辑 Hexo 博客文章，尽可能保留hexo语法（因为作者用惯了bushi
- Obsidian 预览 + Hexo 网站发布
- 主要支持：

	- **图片预览**：Obsidian 和 Hexo 对于`..`这种相对路径支持不一致
		- 解决方案：直接hexo s/d之前相对路径转为绝对路径

	- **链接跳转**：Obsidian 能识别并跳转 Hexo 的永久链接（`abbrlink`），即 `[标题](/posts/123456/)`

	- **图片粘贴**：在 Obsidian 中粘贴图片时，自动保存到 Hexo 指定的 `source/img` 目录，并插入正确的 Markdown 链接。
 
### 2. 文件夹结构

```text

Hexo_Obsidian_Toolkit/

├── obsidian-hexo-helper/       # Obsidian 插件本体

│   ├── main.js                 # 核心代码

│   └── manifest.json           # 插件元数据

├── scripts/                    # 配套脚本

│   ├── convert_to_relative.js  # [一次性] 旧文章路径修复脚本

│   └── fix-hexo-compat.js      # [推荐] Hexo 构建兼容脚本

├── README.md                   # 英文说明文档

└── README_CN.md                # 中文说明文档

```

1.  **插件 (`obsidian-hexo-helper`)**：

    *   **粘贴拦截**：监听 `editor-paste` 事件，图片存入 `source/img`，插入 `../img/` 相对链接。

    *   **点击拦截**：监听全局点击事件，捕获 `/posts/abbrlink` 链接，通过构建 `abbrlink -> 文件路径` 的映射表实现跳转。

    *   **辅助功能**：右键菜单“复制 Hexo 链接”、新建文章自动生成 Front-matter。

2.  **转换脚本 (`convert_to_relative.js`)**：

    *   Node.js 脚本，一次性批量将旧文章的 `/img/` 绝对路径转换为 `../img/` 相对路径。

3.  **构建脚本 (`fix-hexo-compat.js`)**：

    *   Hexo Filter 脚本，在 `hexo generate` 阶段将 `../img/` 还原为 `/img/`。
    *   放到博客根目录下scripts文件夹
### 3. 具体使用方法

#### 安装插件

1.  把 `obsidian-hexo-helper` 文件夹整个复制到 Obsidian 仓库的 `.obsidian/plugins/` 下。

2.  重启 Obsidian，去“第三方插件”里开启 `Hexo Helper`。

#### 修改旧文章图片代码

1.  把 `scripts/convert_to_relative.js` 放到 Hexo 博客根目录下。

2.  运行 `node scripts/convert_to_relative.js`。
 

#### 配置 Hexo（保证网站正常）

1.  把 `scripts/fix-hexo-compat.js` 放到 Hexo 博客的 `scripts/` 文件夹里（Hexo 会自动加载这个目录下的脚本）。

