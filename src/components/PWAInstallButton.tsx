import { Download, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { usePWAInstall } from '../lib/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  className?: string;
}

export function PWAInstallButton({ compact = false, className = '' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  async function handleClick() {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
          compact
            ? 'px-3 py-1.5 text-xs bg-amber-100 text-amber-950 border border-amber-300 hover:bg-amber-200'
            : 'px-3.5 py-2 text-xs bg-orange-50 text-orange-800 border border-orange-300 hover:bg-orange-100'
        } ${className}`}
      >
        {isInstallable ? (
          <Download className="w-3.5 h-3.5 text-orange-600 shrink-0" aria-hidden="true" />
        ) : (
          <Smartphone className="w-3.5 h-3.5 text-orange-600 shrink-0" aria-hidden="true" />
        )}
        <span>
          {isInstallable
            ? 'Pasang Aplikasi Android'
            : isIOS
            ? 'Pasang di iPhone / iPad'
            : isAndroid
            ? 'Pasang di Android'
            : 'Versi Aplikasi Android'}
        </span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Panduan Pasang Aplikasi Android"
        >
          <div className="w-full max-w-md bg-white border border-amber-200 rounded-lg overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-amber-200 bg-amber-50/70 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-5 h-5 text-orange-600 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-stone-950">
                    {isIOS ? 'Pasang Aplikasi di iOS' : 'Pasang Aplikasi Android (Surat FE)'}
                  </h3>
                  <p className="text-[11px] text-stone-600">
                    Buka langsung dari layar utama HP seperti aplikasi native
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 text-stone-500 hover:text-stone-900 rounded"
                aria-label="Tutup panduan"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-stone-700 leading-relaxed">
              {isIOS ? (
                <ol className="space-y-2 list-decimal pl-4">
                  <li>
                    Buka tautan aplikasi ini di browser <strong>Safari</strong> pada iPhone/iPad.
                  </li>
                  <li>
                    Ketuk ikon <strong>Bagikan (Share)</strong> di bilah bawah Safari.
                  </li>
                  <li>
                    Pilih <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>, lalu ketuk{' '}
                    <strong>Tambah</strong>.
                  </li>
                </ol>
              ) : (
                <ol className="space-y-2 list-decimal pl-4">
                  <li>
                    Buka tautan aplikasi ini secara langsung di <strong>Google Chrome</strong> pada
                    HP Android (bukan di dalam jendela pratinjau/iframe).
                  </li>
                  <li>
                    Ketuk tombol <strong>Pasang Aplikasi Android</strong> atau ketuk menu{' '}
                    <strong>⋮ (titik tiga)</strong> di kanan atas Chrome.
                  </li>
                  <li>
                    Pilih <strong>Tambahkan ke layar utama</strong> / <strong>Instal aplikasi</strong>{' '}
                    lalu konfirmasi <strong>Instal</strong>.
                  </li>
                </ol>
              )}

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-950">
                Setelah terpasang, ikon <strong>Surat FE</strong> dengan lambang Universitas Kaltara
                muncul di layar utama Android dan terbuka penuh tanpa bilah alamat browser.
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-amber-200 bg-amber-50/70 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
