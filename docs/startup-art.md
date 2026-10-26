# 启动动画素材

`public/startup-chase/atlas.png` 为本项目通过内置 image_gen 工具生成的透明 PNG 图集，包含英短蓝白小猫与小老鼠各四帧。CSS 以图集帧切换和 transform 实现追逐，不加载在线资源或动画运行库。图片由生成工具输出后原样复制到项目，未将人物素材保留在应用中。

生成提示词：

> Create a production sprite atlas for a cute desktop app loading animation: a tiny adorable British Shorthair blue-and-white bicolor kitten chasing a tiny friendly gray mouse. Exactly 4 equal columns and 2 equal rows (8 cells). Top row: four running keyframes of the same blue-gray and white British Shorthair kitten, facing right, round plush head, white muzzle/chest/belly/paws, pink nose and short chunky limbs. Bottom row: four running keyframes of the same friendly gray mouse, facing right, round ears, pink nose and thin tail. Consistent scale and appearance within each row. Transparent background, clean cute detailed 2D art, readable at small UI sizes. No text, numbers, borders, scenery or ground shadows.

最终调整提示词：

> Refine this exact sprite atlas for implementation, preserving the adorable blue-and-white British Shorthair kitten and mouse designs and four running poses. Use a strict 4-column x 2-row grid of equal square cells with no visible grid lines. Each sprite must fit entirely inside its cell; the fourth kitten's whole face, nose and whiskers must be visible. All kitten bodies same scale, mouse appearance consistent, all facing right. Keep true transparent alpha background and exactly eight sprites. No text, numbers, borders, scenery or shadows.

最终文件为 1774×887。启动 CSS 按素材实际图像区域选帧；若替换图集，应同步检查帧位置和脚部基线，避免裁掉角色。

`public/empty-state.png` 和 `public/changes-empty.png` 为用户提供的透明图标，分别用于“空空如也”和右侧无变更状态。

便携启动前的解压提示由 `scripts/portable-splash.ps1` 使用系统绘图 API 生成 BMP；正式启动后使用共享的 `public/startup.html`、`public/startup.css`。减少动态效果模式下保持角色静止。
