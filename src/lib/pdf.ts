import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';

async function waitForImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        window.setTimeout(done, 3000);
      });
    })
  );
}

export async function downloadLetterAsPdf(
  element: HTMLElement,
  fileName: string
): Promise<void> {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore font readiness failures
    }
  }

  await waitForImages(element);

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: 960,
    onclone: (_clonedDoc, clonedEl) => {
      clonedEl.style.width = '794px';
      clonedEl.style.maxWidth = '794px';
      clonedEl.style.padding = '36px 52px';
      clonedEl.style.boxSizing = 'border-box';
      clonedEl.querySelectorAll('.no-print').forEach((node) => {
        if (node instanceof HTMLElement) {
          node.style.display = 'none';
        }
      });
    },
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  let renderWidth = pageWidth;
  let renderHeight = (canvas.height * renderWidth) / canvas.width;

  if (renderHeight > pageHeight) {
    const scaleDown = pageHeight / renderHeight;
    renderWidth *= scaleDown;
    renderHeight = pageHeight;
  }

  const offsetX = Math.max(0, (pageWidth - renderWidth) / 2);
  pdf.addImage(imgData, 'PNG', offsetX, 0, renderWidth, renderHeight, undefined, 'FAST');

  const normalizedName = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const finalName = normalizedName
    ? normalizedName.toLowerCase().endsWith('.pdf')
      ? normalizedName
      : `${normalizedName}.pdf`
    : 'Surat_Resmi.pdf';

  pdf.save(finalName);
}
