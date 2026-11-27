import { Download, FileText, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchProtectedBlob, formatBytes } from '../lib/api';
import type { UploadedDocument } from '../shared/types';

export interface CustomDocumentSource {
  url: string;
  title: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}

interface DocumentViewerModalProps {
  document?: UploadedDocument | null;
  customSource?: CustomDocumentSource | null;
  token: string;
  onClose: () => void;
}

export function DocumentViewerModal({
  document,
  customSource,
  token,
  onClose,
}: DocumentViewerModalProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSource = customSource
    ? {
        url: customSource.url,
        title: customSource.title,
        fileName: customSource.fileName,
        mimeType: customSource.mimeType || 'application/pdf',
        sizeBytes: customSource.sizeBytes ?? 0,
      }
    : document
    ? {
        url: `/api/files/${document.id}`,
        title: document.doc_type,
        fileName: document.original_name,
        mimeType: document.mime_type,
        sizeBytes: document.size_bytes,
      }
    : null;

  useEffect(() => {
    if (!activeSource) {
      setObjectUrl(null);
      return;
    }

    let revoked = false;
    let activeUrl: string | null = null;
    setLoading(true);
    setError(null);

    fetchProtectedBlob(activeSource.url, token)
      .then((blob) => {
        if (revoked) return;
        activeUrl = URL.createObjectURL(blob);
        setObjectUrl(activeUrl);
      })
      .catch((err) => {
        if (revoked) return;
        setError(err instanceof Error ? err.message : 'Gagal memuat pratinjau dokumen.');
      })
      .finally(() => {
        if (!revoked) setLoading(false);
      });

    return () => {
      revoked = true;
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [activeSource?.url, token]);

  if (!activeSource) return null;

  const isPdf = activeSource.mimeType === 'application/pdf';
  const isImage = activeSource.mimeType.startsWith('image/');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Pratinjau ${activeSource.fileName}`}
    >
      <div className="flex flex-col w-full max-w-4xl h-[85vh] bg-white border border-amber-200 rounded-lg overflow-hidden shadow-xl">
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-amber-200 bg-amber-50/70">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-stone-900 truncate">
              {activeSource.title}
            </h3>
            <p className="text-xs text-stone-500 truncate mt-0.5">
              {activeSource.fileName}
              {activeSource.sizeBytes > 0 ? ` · ${formatBytes(activeSource.sizeBytes)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {objectUrl && (
              <a
                href={objectUrl}
                download={activeSource.fileName}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Unduh</span>
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-amber-200/70 rounded-md transition-colors"
              aria-label="Tutup pratinjau"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-amber-50/40 flex items-center justify-center overflow-auto p-4">
          {loading && (
            <div className="flex flex-col items-center gap-2 text-stone-600">
              <Loader2 className="w-6 h-6 animate-spin text-orange-600" />
              <span className="text-sm">Memuat dokumen...</span>
            </div>
          )}

          {!loading && error && (
            <div className="max-w-md text-center bg-white border border-rose-200 rounded-lg p-6">
              <FileText className="w-8 h-8 text-rose-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-stone-900">Dokumen tidak dapat ditampilkan</p>
              <p className="text-xs text-stone-600 mt-1">{error}</p>
            </div>
          )}

          {!loading && !error && objectUrl && isPdf && (
            <iframe
              src={objectUrl}
              title={activeSource.fileName}
              className="w-full h-full bg-white border border-amber-200 rounded"
            />
          )}

          {!loading && !error && objectUrl && isImage && (
            <img
              src={objectUrl}
              alt={activeSource.fileName}
              referrerPolicy="no-referrer"
              className="max-w-full max-h-full object-contain bg-white border border-amber-200 rounded"
            />
          )}

          {!loading && !error && objectUrl && !isPdf && !isImage && (
            <div className="text-center bg-white border border-amber-200 rounded-lg p-6">
              <FileText className="w-8 h-8 text-amber-600 mx-auto mb-2" />
              <p className="text-sm text-stone-700 mb-3">
                Pratinjau langsung tidak tersedia untuk tipe berkas ini.
              </p>
              <a
                href={objectUrl}
                download={activeSource.fileName}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh Berkas</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
