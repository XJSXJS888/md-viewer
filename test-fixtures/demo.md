# Markdown 示例

这是一份用来检查阅读和编辑功能的示例文档。

## 文本格式

**加粗**、*斜体*、~~删除线~~，以及[链接](https://www.markdownguide.org/)。

行内代码：`const ready = true`。

> 引用会使用浅蓝背景，和正文区分开。

> [!NOTE]
> 提示块会显示标签，适合放补充说明。

## 列表

- 无序列表
- 第二项
  - 嵌套项

1. 有序列表
2. 第二项

- [x] 已完成
- [ ] 未完成

## 表格

| 格式 | 支持 | 说明 |
| :--- | :---: | ---: |
| 表格 | 是 | 对齐 |
| 任务列表 | 是 | 静态展示 |
| 代码块 | 是 | 高亮与复制 |

## 代码

~~~javascript
function greet(name) {
  return 'Hello, ' + name;
}

console.log(greet('Markdown'));
~~~

## 图片

![MD Viewer](../build/icon.png)

## 编辑

点击右上角的「编辑」进入修改模式。

- Ctrl + S 保存
- Ctrl + B 加粗选中文字
- Ctrl + I 设为斜体

保存时会沿用文件原来的编码和换行符。

## 结束

切换到「阅读」查看渲染结果。
