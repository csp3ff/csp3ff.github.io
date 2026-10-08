import fs from "node:fs";
import path from "node:path";

// 这些目录只用于站点配置或静态资源，不属于文档项目。
const HIDDEN_ENTRIES = new Set([
  "index.md",
  "public",
  ".vitepress",
  "node_modules",
  ".idea",
  "assets",
]);

const byName = (left, right) =>
  left.localeCompare(right, "zh-CN", { numeric: true });

function buildItems(directory, route = "") {
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !HIDDEN_ENTRIES.has(entry.name))
    .sort((left, right) => {
      // 项目/子目录优先展示，再展示目录中的 Markdown 页面。
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return byName(left.name, right.name);
    });

  return entries.flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    const entryRoute = `${route}/${entry.name}`;

    if (entry.isDirectory()) {
      const items = buildItems(entryPath, entryRoute);

      // 不显示没有 Markdown 内容的目录，项目及子目录均默认折叠。
      return items.length
        ? [{ text: entry.name, collapsed: true, items }]
        : [];
    }

    if (!entry.isFile() || path.extname(entry.name) !== ".md") {
      return [];
    }

    return [
      {
        text: path.basename(entry.name, ".md"),
        link: entryRoute.replace(/\.md$/, ""),
      },
    ];
  });
}

export const set_sidebar = (pathname) =>
  buildItems(path.resolve(pathname));
