# 状态栏猫咪摆件

实现：`src/components/StatusCat.tsx`，本地资源：`public/status-cat/atlas.png`。摆件默认显示，在偏好设置中的“显示猫咪摆件”关闭后保存选择。计时器与可见性监听随关闭卸载；不产生音频、网络请求、弹窗或交互记录。

React、CSS 背景选帧、标准浏览器可见性和减少动态效果 API 用于所有平台。阅读代码时不调度自动动作；窗口失焦或进入后台后取消动作。主界面的摆件与 Windows 便携包专用的原生解压窗口彼此独立。当前在 Windows Electron 中验证，未声称已完成 macOS／Linux 实机测试。

素材通过内置 `image_gen` 工具生成，使用已有 `public/startup-chase/atlas.png` 中的小猫作为外观参考，输出后原样复制到上述项目路径，保留透明背景。未替换启动动画素材。

生成提示词：

> Use case: identity-preserve illustration sprite sheet. Create a new production sprite atlas of ONLY the same adorable blue-and-white British Shorthair kitten from the reference, preserving its plush round head, blue-gray coat, white muzzle/chest/paws, pink nose, gentle 2D illustrated style. No mouse. For a tiny quiet status-bar companion in a desktop coding app. STRICT 4 columns x 2 rows, equal square cells, total canvas landscape 2:1, transparent RGBA background. Every kitten entirely inside its own cell with generous 12% transparent margin and aligned bottom baseline; no clipped ears/tails/paws, no overlaps, all characters same scale. Exactly 8 poses: top row col1 front-facing head and front paws peeking curiously, col2 same peek with eyes closed in a blink, col3 curled up sleeping with tail around body and closed eyes, col4 same curled sleeping pose breathing gently. Bottom row col1 low relaxed lying down eyes open, col2 same lying down eyes closed, col3 happy response to being petted with eyes closed and one front paw slightly raised, col4 a cute gentle stretch. No text, letters, numbers, grid, frames, scenery, shadows, props or background. Keep silhouette readable at 40-pixel size, restrained soft outlines.

验证：`node tests/desktop-cat.mjs` 覆盖本地资源、探头眨眼、点击互动、浅深色、减少动态效果、关闭后重启保留、无效设置拒绝和代码阅读时保持安静。
