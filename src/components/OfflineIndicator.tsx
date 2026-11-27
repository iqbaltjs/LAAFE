import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../lib/usePWAInstall';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 lg:bottom-4 left-4 right-4 sm:right-auto z-50 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>Mode Luring — Koneksi terputus, periksa jaringan internet Anda.</span>
    </div>
  );
}
