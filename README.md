# MD Viewer

Windows 下的本地 Markdown 阅读与编辑工具。界面采用浅蓝色，支持阅读、编辑、保存和自动刷新。

![MD Viewer](docs/preview-light.png)

## 下载

在 [Releases](../../releases/latest) 页面下载最新的 `MDViewer.exe`。

## 使用

双击下载后的 `MDViewer.exe`。

- 打开文件，或将 `.md` / `.markdown` 文件拖进窗口
- 在右上角切换「阅读」和「编辑」
- 编辑时按 `Ctrl + S` 保存
- 首次启动会解压到临时目录，通常需要几秒

支持 Windows 10 / 11（x64）。程序未签名，SmartScreen 首次运行可能提示，选择「更多信息 → 仍要运行」。

## 功能

- Markdown 阅读与编辑
- GFM 表格、任务列表、引用、代码块和相对路径图片
- 代码语法高亮、复制、文档目录和页内查找
- 保存时保留原文件的编码、BOM 和换行符
- 文件被外部修改后自动刷新；有未保存内容时暂停刷新
- 关闭或切换文件前提示保存
- 浅色、深色和跟随系统，窗口标题栏同步切换
- 最近打开、正文字号调节

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl + O` | 打开文件 |
| `Ctrl + S` | 保存 |
| `Ctrl + R` / `F5` | 重新加载 |
| `Ctrl + F` | 在阅读模式中查找 |
| `Ctrl + B` | 阅读模式：目录；编辑模式：加粗 |
| `Ctrl + I` | 编辑模式：斜体 |
| `Ctrl + +` / `Ctrl + -` | 调整字号 |
| `Ctrl + 0` | 恢复默认字号 |
| `Esc` | 关闭查找或目录 |

## 数据

- 渲染和编辑都在本机完成。
- 最近打开记录和窗口大小保存在 `%APPDATA%\MD Viewer\viewer-state.json`。
- 如果文档引用了远程图片，Electron 会按文档中的地址加载。

## 构建

需要 Node.js 22+：

~~~powershell
npm install
npm start
~~~

打包：

~~~powershell
npm run dist
~~~

打包后的文件位于 `release/`。

Electron 下载较慢时可以设置：

~~~powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
~~~

## 目录

~~~text
md-viewer/
├─ src/
│  ├─ main.js              Electron 主进程：窗口、文件读写、编码处理
│  ├─ preload.js           IPC 桥接
│  └─ renderer/            界面、Markdown 渲染、编辑器
├─ build/                  应用图标
├─ scripts/make-icon.js    图标生成脚本
├─ test-fixtures/demo.md   示例文档
└─ release/                exe 产物
~~~

MIT License.
