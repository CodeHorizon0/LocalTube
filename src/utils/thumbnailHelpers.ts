import { invoke } from "@tauri-apps/api/core";
import { ColorGroup } from "../types";

const thumbnailCache = new Map<string, string>();
const previewGifCache = new Map<string, string>();
export const shadowColorCache = new Map<string, string>();

export function generateThumbnail(videoPath: string): Promise<string> {
  return new Promise(function (resolve, reject) {
    const cached = thumbnailCache.get(videoPath);
    if (cached) {
      resolve(cached);
      return;
    }
    invoke<string>("gen_thumb", { videoPath: videoPath })
      .then(function (base64) {
        const dataUrl = "data:image/jpeg;base64," + base64;
        thumbnailCache.set(videoPath, dataUrl);
        resolve(dataUrl);
      })
      .catch(function (err) {
        reject(err);
      });
  });
}

export function generatePreviewGif(videoPath: string): Promise<string> {
  return new Promise(function (resolve, reject) {
    const cached = previewGifCache.get(videoPath);
    if (cached) {
      resolve(cached);
      return;
    }
    invoke<string>("gen_gif", { videoPath: videoPath })
      .then(function (base64) {
        const dataUrl = "data:image/gif;base64," + base64;
        previewGifCache.set(videoPath, dataUrl);
        resolve(dataUrl);
      })
      .catch(function (err) {
        reject(err);
      });
  });
}

export function computeShadowColor(img: HTMLImageElement): string | null {
  const src = img.src || img.currentSrc;
  if (src && shadowColorCache.has(src)) {
    return shadowColorCache.get(src)!;
  }

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w === 0 || h === 0) {
      return null;
    }

    const targetSize = 100;
    let drawW = w;
    let drawH = h;
    if (w > targetSize || h > targetSize) {
      const ratio = Math.min(targetSize / w, targetSize / h);
      drawW = Math.round(w * ratio);
      drawH = Math.round(h * ratio);
    }

    canvas.width = drawW;
    canvas.height = drawH;
    ctx.drawImage(img, 0, 0, drawW, drawH);

    const imageData = ctx.getImageData(0, 0, drawW, drawH);
    const data = imageData.data;

    const shift = 3;
    const map = new Map<string, ColorGroup>();

    for (let y = 0; y < drawH; y++) {
      for (let x = 0; x < drawW; x++) {
        if ((x + y) % 2 !== 0) continue;
        const idx = (y * drawW + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const key = (r >> shift) + "," + (g >> shift) + "," + (b >> shift);
        const existing = map.get(key);
        if (existing) {
          existing.count++;
          existing.sumR += r;
          existing.sumG += g;
          existing.sumB += b;
        } else {
          map.set(key, {
            count: 1,
            sumR: r,
            sumG: g,
            sumB: b,
          });
        }
      }
    }

    if (map.size === 0) {
      return null;
    }

    const groups = Array.from(map.values());
    groups.sort(function (a, b) {
      return b.count - a.count;
    });

    const primary = groups[0];
    let secondary: ColorGroup | null = null;
    if (groups.length > 1) {
      secondary = groups[1];
    }

    let shadowR: number, shadowG: number, shadowB: number;
    if (secondary) {
      const pR = Math.round(primary.sumR / primary.count);
      const pG = Math.round(primary.sumG / primary.count);
      const pB = Math.round(primary.sumB / primary.count);
      const sR = Math.round(secondary.sumR / secondary.count);
      const sG = Math.round(secondary.sumG / secondary.count);
      const sB = Math.round(secondary.sumB / secondary.count);
      shadowR = Math.round((pR + sR) / 2);
      shadowG = Math.round((pG + sG) / 2);
      shadowB = Math.round((pB + sB) / 2);
    } else {
      shadowR = Math.round(primary.sumR / primary.count);
      shadowG = Math.round(primary.sumG / primary.count);
      shadowB = Math.round(primary.sumB / primary.count);
    }

    let brightness = (shadowR + shadowG + shadowB) / 3;
    const minBright = 50;
    const maxBright = 200;
    if (brightness < minBright) {
      const factor = minBright / brightness;
      shadowR = Math.min(255, Math.round(shadowR * factor));
      shadowG = Math.min(255, Math.round(shadowG * factor));
      shadowB = Math.min(255, Math.round(shadowB * factor));
    } else if (brightness > maxBright) {
      const factor = maxBright / brightness;
      shadowR = Math.round(shadowR * factor);
      shadowG = Math.round(shadowG * factor);
      shadowB = Math.round(shadowB * factor);
    }

    const result = "rgba(" + shadowR + ", " + shadowG + ", " + shadowB + ", 0.5)";
    if (src) {
      shadowColorCache.set(src, result);
    }
    return result;
  } catch (_) {
    return null;
  }
}