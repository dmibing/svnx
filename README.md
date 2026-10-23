# SVNX

基于 Electron、React 和 TypeScript 的 Subversion 桌面客户端。当前版本为 **0.1.9**，优先支持 Windows x64，界面使用简体中文。

文件类型图标使用 [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)（MIT），通过构建脚本生成本地资源，许可证随应用包含。未知类型回退到通用文件图标。

更新详情见 [更新记录](CHANGELOG.md)。

## 功能

- 检出 SVN 仓库、打开已有工作副本或其子目录、切换多个项目；移除项目记录不会删除本地目录。
- 文件状态、搜索、筛选、多选，以及虚拟化的紧凑文件列表。
- 提交前预览真实影响范围；支持多行提交说明，失败保留输入，避免带入未选文件。
- 更新到 HEAD 或指定版本；还原、删除和冲突解决前备份文件内容。
- 文件添加、移动、重命名、忽略、属性读写、加锁、解锁和工作副本清理。
- 分页版本历史、文件历史、指定版本之间的差异，保留复制和重命名历史。
- 本地 Monaco 差异浏览，支持并排／行内、空白忽略、变更跳转和属性差异。
- 文本冲突合并与标记解决；属性冲突策略选择；树冲突信息与人工修复确认。
- 浅色、深色、跟随系统主题，保存主题和面板宽度。
- 后台任务状态、取消任务、认证失败后的显式重试；输入的密码不会写入设置。

## 使用

需要本机安装 **SVN 1.14 或更高版本**。启动后自动检测 `svn`；也可以在“偏好设置”中选择可执行文件。仓库支持本地文件、HTTP(S) 和 svn 协议；svn+ssh 复用本机已有 SSH 配置。

便携版为单个 Windows x64 EXE，无需安装。应用设置和操作备份保存在 Electron 的用户数据目录（可通过设置中的“打开备份目录”定位），不保存在 Git 仓库中。

快捷键：`F5` 刷新，`Ctrl+Enter` 打开提交面板，`Ctrl+,` 打开偏好设置，`Esc` 关闭弹窗。

## 开发与构建

需要 Node.js 22+、npm，以及 SVN。集成测试另外需要 `svnadmin` 和 `svnserve`。

```sh
npm ci
npm run desktop
```

```sh
npm test                 # 真实本地仓库与认证集成测试
npm run test:desktop     # 构建及 Electron 桌面交互验证
npm run build            # 类型检查与生产构建
npm run dist:portable    # Windows x64 单文件便携版
npm run dist             # Windows x64 NSIS 安装包
```

构建结果保存在 `release/`，不提交到 Git。`npm run dev` 仅用于浏览器布局预览，真实 SVN 操作需要 Electron preload 桥接。

图标原始素材位于 `assets/`，当前应用图标位于 `public/brand.png`。执行 `npm run build:icons` 生成多尺寸 Windows ICO。当前图标为裁剪处理版本，颜色与原始素材仍存在差异，后续修正。

## 架构

- `electron/main.cjs`：窗口、原生文件选择、配置持久化、受限 IPC 与文件监听。
- `electron/worker.cjs`、`svn.cjs`、`runner.cjs`：独立 utilityProcess 中的 SVN 执行、XML 解析和领域操作。
- `electron/scheduler.cjs`：重叠工作副本任务串行、跨工作副本并发限流、任务取消。
- `electron/backup.cjs`：操作前文件备份及恢复；单次上限 512 MB，每个工作副本累计上限 2 GB，达到上限会停止操作。
- `src/components/`：工作区文件列表、差异、历史、操作弹窗；`src/client.ts` 管理请求、认证挑战和共享状态。
- `src/i18n/zh-CN.ts`：集中管理公共状态、操作与错误提示，为后续多语言扩展保留边界。

渲染层禁用 Node 集成，启用沙箱和上下文隔离；仅开放允许的 IPC 方法。SVN 使用参数数组启动，不拼接 shell。凭据通过标准输入传递；当前认证仅供用户明确发起的一次重试使用，不建立额外密码库。

## 当前验证范围与边界

已通过 14 项服务集成测试和 Electron 桌面测试，包括中文／空格／`@` 路径、部分提交、新增父目录依赖、过期预览拒绝、还原备份恢复、忽略及属性、重命名历史、文本冲突、二进制／大文件限制、任务队列与 svnserve 认证。

- 分支、标签、切换和合并不在当前版本范围内。
- 树冲突需要先人工修复目录结构，再确认当前状态为已解决；不自动猜测修复策略。
- 二进制显示大小信息；超过 5 MB 不自动展开，显式加载上限 32 MB；外部差异工具当前支持文本快照。
- 符号链接路径的文件操作会被拒绝；超出系统 ANSI 代码页能力的 Windows 文件名可能受本机 SVN 限制。
- 备份恢复只恢复内容，不回滚 SVN 调度状态；请刷新并核对结果。
- 尚未完成十万文件的性能基准、完整 HTTPS 证书组合及全部树冲突场景验证，不将这些能力标记为已验收。
- 便携 EXE 未配置发布方代码签名证书。

## 许可证

[MIT](LICENSE)。依赖及其许可证见 `package.json` 和 npm 包内的 LICENSE。
