import { defineConfig } from "vitepress";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isProjectPages = repository && !repository.endsWith(".github.io");
const base = process.env.GITHUB_ACTIONS && isProjectPages ? `/${repository}/` : "/";

export default defineConfig({
  title: "MomoTodo",
  description: "MomoTodo 桌面端开发与发布文档。",
  base,
  themeConfig: {
    nav: [{ text: "开发启动", link: "/guide/development" }],
    sidebar: [
      {
        text: "指南",
        items: [{ text: "开发启动", link: "/guide/development" }],
      },
    ],
    socialLinks: [],
  },
});
