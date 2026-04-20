/**
 * ภาพ NSIS: BMP 24-bit, พื้นขาว + โลโก้กึ่งกลาง (blend alpha กับขาว)
 */
const fs = require("fs");
const path = require("path");
const Jimp = require("jimp");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const ICON_PATH = path.join(ROOT, "assets", "icon.png");

const WHITE = { r: 255, g: 255, b: 255 };

const HEADER_W = 150;
const HEADER_H = 57;
const SIDEBAR_W = 164;
const SIDEBAR_H = 314;

function writeBmp24(filepath, width, height, getRgb) {
  const rowSize = ((width * 3 + 3) >> 2) << 2;
  const imageSize = rowSize * height;
  const fileSize = 54 + imageSize;
  const buf = Buffer.alloc(fileSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(imageSize, 34);
  buf.writeUInt32LE(0, 38);
  buf.writeUInt32LE(0, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);
  let off = 54;
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row;
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getRgb(x, y);
      buf[off++] = b;
      buf[off++] = g;
      buf[off++] = r;
    }
    const pad = rowSize - width * 3;
    for (let p = 0; p < pad; p++) buf[off++] = 0;
  }
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, buf);
}

/** วาดโลโก้ทับพื้นหลัง แบบ alpha blend */
function blitIcon(dstGet, dstSet, dw, dh, icon, ox, oy) {
  const iw = icon.bitmap.width;
  const ih = icon.bitmap.height;
  for (let iy = 0; iy < ih; iy++) {
    for (let ix = 0; ix < iw; ix++) {
      const x = ox + ix;
      const y = oy + iy;
      if (x < 0 || y < 0 || x >= dw || y >= dh) continue;
      const { r: sr, g: sg, b: sb, a: sa } = Jimp.intToRGBA(icon.getPixelColor(ix, iy));
      if (sa === 0) continue;
      const bg = dstGet(x, y);
      const t = sa / 255;
      dstSet(x, y, {
        r: Math.round(sr * t + bg.r * (1 - t)),
        g: Math.round(sg * t + bg.g * (1 - t)),
        b: Math.round(sb * t + bg.b * (1 - t)),
      });
    }
  }
}

async function makeHeader() {
  const px = [];
  for (let y = 0; y < HEADER_H; y++) {
    px[y] = [];
    for (let x = 0; x < HEADER_W; x++) {
      px[y][x] = { ...WHITE };
    }
  }
  if (fs.existsSync(ICON_PATH)) {
    const icon = await Jimp.read(ICON_PATH);
    icon.resize(36, 36);
    const ox = Math.floor((HEADER_W - 36) / 2);
    const oy = Math.floor((HEADER_H - 36) / 2);
    blitIcon(
      (x, y) => px[y][x],
      (x, y, c) => {
        px[y][x] = c;
      },
      HEADER_W,
      HEADER_H,
      icon,
      ox,
      oy
    );
  }
  writeBmp24(path.join(BUILD, "installerHeader.bmp"), HEADER_W, HEADER_H, (x, y) => px[y][x]);
  console.log("สร้างแล้ว: build/installerHeader.bmp");
}

async function makeSidebar() {
  const px = [];
  for (let y = 0; y < SIDEBAR_H; y++) {
    px[y] = [];
    for (let x = 0; x < SIDEBAR_W; x++) {
      px[y][x] = { ...WHITE };
    }
  }
  if (fs.existsSync(ICON_PATH)) {
    const icon = await Jimp.read(ICON_PATH);
    icon.resize(72, 72);
    const ox = Math.floor((SIDEBAR_W - 72) / 2);
    const oy = Math.floor((SIDEBAR_H - 72) / 2);
    blitIcon(
      (x, y) => px[y][x],
      (x, y, c) => {
        px[y][x] = c;
      },
      SIDEBAR_W,
      SIDEBAR_H,
      icon,
      ox,
      oy
    );
  }
  writeBmp24(path.join(BUILD, "installerSidebar.bmp"), SIDEBAR_W, SIDEBAR_H, (x, y) => px[y][x]);
  console.log("สร้างแล้ว: build/installerSidebar.bmp");
}

async function main() {
  try {
    await makeHeader();
    await makeSidebar();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
