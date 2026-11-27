/**
 * Client-side signature helper that strips neutral checkerboard / paper backgrounds
 * and corner watermarks so scanned or exported signatures sit cleanly over official PDFs.
 */
export async function processSignatureImage(src: string, autoClean = true): Promise<string> {
  if (!src || !autoClean) return src;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const maxWidth = 1100;
        const scale = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Detect if the PNG already carries genuine transparent corners
        let transparentCornerSamples = 0;
        const samplePoints = [
          [2, 2],
          [width - 3, 2],
          [2, height - 3],
          [width - 3, height - 3],
          [Math.floor(width / 2), 2],
        ];
        for (const [sx, sy] of samplePoints) {
          if (sx >= 0 && sy >= 0 && sx < width && sy < height) {
            const idx = (sy * width + sx) * 4;
            if (data[idx + 3] < 240) transparentCornerSamples++;
          }
        }
        const alreadyTransparent = transparentCornerSamples >= 3;

        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            let a = data[idx + 3];

            if (!alreadyTransparent && a > 0) {
              const maxCh = Math.max(r, g, b);
              const minCh = Math.min(r, g, b);
              const sat = maxCh - minCh;
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;

              // Strip neutral bottom-right generator watermarks (e.g., "Dola AI")
              const inBottomRightCorner = x > width * 0.78 && y > height * 0.85;
              if (inBottomRightCorner && sat < 40) {
                a = 0;
              } else if (sat < 30 && lum > 165) {
                // Checkerboard light/gray cells or white paper background
                a = 0;
              } else if (sat < 30 && lum > 135) {
                // Soft anti-aliased edge for black ink
                a = Math.round(((165 - lum) / 30) * 255);
              }
              data[idx + 3] = a;
            }

            if (a > 18) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);

        if (maxX < minX || maxY < minY) {
          resolve(src);
          return;
        }

        const pad = 10;
        const cropX = Math.max(0, minX - pad);
        const cropY = Math.max(0, minY - pad);
        const cropW = Math.min(width - cropX, maxX - minX + 1 + pad * 2);
        const cropH = Math.min(height - cropY, maxY - minY + 1 + pad * 2);

        const cropped = document.createElement('canvas');
        cropped.width = cropW;
        cropped.height = cropH;
        const cropCtx = cropped.getContext('2d');
        if (!cropCtx) {
          resolve(canvas.toDataURL('image/png'));
          return;
        }
        cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        resolve(cropped.toDataURL('image/png'));
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}
