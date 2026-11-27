import { AlertCircle, CheckCircle2, Clock, FileSearch, Upload, XCircle } from 'lucide-react';
import type { RequestStatus } from '../shared/types';

interface StatusIndicatorProps {
  status: RequestStatus;
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  switch (status) {
    case 'Disetujui':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Disetujui</span>
        </span>
      );
    case 'Sedang Diproses':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-700 whitespace-nowrap">
          <FileSearch className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Sedang Diproses</span>
        </span>
      );
    case 'Menunggu Berkas':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 whitespace-nowrap">
          <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Menunggu Berkas</span>
        </span>
      );
    case 'Perlu Revisi':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 whitespace-nowrap">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Perlu Revisi</span>
        </span>
      );
    case 'Ditolak':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Ditolak</span>
        </span>
      );
    case 'Menunggu Verifikasi':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Menunggu Verifikasi</span>
        </span>
      );
  }
}
