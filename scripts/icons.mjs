import fs from "node:fs/promises";
import { PNG } from "pngjs";
import pngToIco from "png-to-ico";
const source = PNG.sync.read(await fs.readFile("public/brand.png"));
const size = Math.max(source.width, source.height);
const square = new PNG({ width: size, height: size });
// 仅补齐正方形画布以符合 ICO 格式，不裁切、不重绘原始图标。
for (let i = 0; i < square.data.length; i += 4)
  source.data.copy(square.data, i, 0, 4);
const x = Math.floor((size - source.width) / 2),
  y = Math.floor((size - source.height) / 2);
PNG.bitblt(source, square, 0, 0, source.width, source.height, x, y);
await fs.mkdir("build", { recursive: true });
await fs.writeFile("build/icon.png", PNG.sync.write(square));
await fs.writeFile("build/icon.ico", await pngToIco("build/icon.png"));
console.log("已生成 Windows 多尺寸 ICO，原始品牌图保持不变。");
