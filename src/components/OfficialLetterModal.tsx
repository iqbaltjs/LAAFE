import { Download, Loader2, PenTool, RotateCcw, ShieldCheck, Stamp, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { formatTanggalLengkap } from '../lib/api';
import { downloadLetterAsPdf } from '../lib/pdf';
import { processSignatureImage } from '../lib/signature';
import {
  DEFAULT_DEAN_SIGNATURE_URL,
  DEFAULT_DEAN_STAMP_URL,
  DEFAULT_LETTER_SETTINGS,
  DEFAULT_UNIVERSITY_LOGO_URL,
  LETTER_SERVICES,
  formatMulaiStudiText,
  getLetterService,
  getRomanMonth,
  type LetterRequest,
  type LetterServiceDefinition,
  type LetterTemplateSettings,
} from '../shared/types';

interface OfficialLetterModalProps {
  request: LetterRequest | null;
  services?: LetterServiceDefinition[];
  templateSettings?: LetterTemplateSettings | null;
  isStaff?: boolean;
  autoDownloadPdf?: boolean;
  onAutoDownloadDone?: () => void;
  onClose: () => void;
}

const BUILTIN_FIELD_NAMES: Record<string, string[]> = {
  AKTIF_KULIAH: [
    'nik',
    'tempat_lahir',
    'tanggal_lahir',
    'jenis_kelamin',
    'jenjang',
    'mulai_studi',
    'alamat',
    'keperluan',
  ],
  MAGANG_PKL: [
    'nama_instansi',
    'jabatan_penerima',
    'alamat_instansi',
    'tanggal_mulai',
    'tanggal_selesai',
    'bidang_magang',
  ],
  IZIN_PENELITIAN: [
    'judul_penelitian',
    'lokasi_penelitian',
    'pimpinan_tujuan',
    'periode_penelitian',
    'dosen_pembimbing',
  ],
  REKOMENDASI_BEASISWA: [
    'nama_beasiswa',
    'penyelenggara',
    'ipk_terakhir',
    'prestasi_pendukung',
  ],
  KETERANGAN_LULUS: ['tanggal_yudisium', 'judul_tugas_akhir', 'ipk_akhir', 'predikat'],
  IZIN_OBSERVASI: [
    'jenis_observasi',
    'anggota_kelompok',
    'mata_kuliah',
    'topik_observasi',
    'nama_instansi',
    'pimpinan_tujuan',
    'alamat_instansi',
    'periode_observasi',
    'dosen_pengampu',
  ],
  PINDAH_KULIAH: [
    'jenjang',
    'kampus_tujuan',
    'fakultas_prodi_tujuan',
    'semester_terakhir',
    'alasan_pindah',
  ],
};

export function OfficialLetterModal({
  request,
  services = LETTER_SERVICES,
  templateSettings,
  isStaff = false,
  autoDownloadPdf = false,
  onAutoDownloadDone,
  onClose,
}: OfficialLetterModalProps) {
  const [emblemFailed, setEmblemFailed] = useState(false);

  const tpl = templateSettings || DEFAULT_LETTER_SETTINGS;
  const isAktifKuliah = request?.letter_type === 'AKTIF_KULIAH';
  const configuredSigUrl = tpl.aktif_kuliah_signature_url || DEFAULT_DEAN_SIGNATURE_URL;
  const configuredStampUrl = tpl.aktif_kuliah_stamp_url || DEFAULT_DEAN_STAMP_URL;

  const [includeSignature, setIncludeSignature] = useState<boolean>(
    tpl.aktif_kuliah_signature_enabled ?? true
  );
  const [includeStamp, setIncludeStamp] = useState<boolean>(
    tpl.aktif_kuliah_stamp_enabled ?? true
  );
  const [autoCleanBg, setAutoCleanBg] = useState<boolean>(true);
  const [customSigFileUrl, setCustomSigFileUrl] = useState<string | null>(null);
  const [customSigLabel, setCustomSigLabel] = useState<string | null>(null);
  const [processedSigUrl, setProcessedSigUrl] = useState<string | null>(null);
  const [sigFailed, setSigFailed] = useState<boolean>(false);
  const sigFileInputRef = useRef<HTMLInputElement | null>(null);

  const [customStampFileUrl, setCustomStampFileUrl] = useState<string | null>(null);
  const [customStampLabel, setCustomStampLabel] = useState<string | null>(null);
  const [processedStampUrl, setProcessedStampUrl] = useState<string | null>(null);
  const [stampFailed, setStampFailed] = useState<boolean>(false);
  const stampFileInputRef = useRef<HTMLInputElement | null>(null);

  const letterContentRef = useRef<HTMLDivElement | null>(null);
  const [savingPdf, setSavingPdf] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const autoDownloadedRef = useRef(false);

  useEffect(() => {
    if (!request) return;
    setIncludeSignature(tpl.aktif_kuliah_signature_enabled ?? true);
    setIncludeStamp(tpl.aktif_kuliah_stamp_enabled ?? true);
    setCustomSigFileUrl(null);
    setCustomSigLabel(null);
    setSigFailed(false);
    setCustomStampFileUrl(null);
    setCustomStampLabel(null);
    setStampFailed(false);
    setPdfError('');
    autoDownloadedRef.current = false;
  }, [request?.id, tpl.aktif_kuliah_signature_enabled, tpl.aktif_kuliah_stamp_enabled]);

  useEffect(() => {
    if (!autoDownloadPdf) {
      autoDownloadedRef.current = false;
    }
  }, [autoDownloadPdf]);

  const rawSignatureSrc = customSigFileUrl || configuredSigUrl;
  const rawStampSrc = customStampFileUrl || configuredStampUrl;

  useEffect(() => {
    let cancelled = false;
    if (!isAktifKuliah || !includeSignature || !rawSignatureSrc) {
      setProcessedSigUrl(null);
      return;
    }

    setSigFailed(false);
    processSignatureImage(rawSignatureSrc, autoCleanBg).then((resultUrl) => {
      if (!cancelled) {
        setProcessedSigUrl(resultUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isAktifKuliah, includeSignature, rawSignatureSrc, autoCleanBg]);

  useEffect(() => {
    let cancelled = false;
    if (!isAktifKuliah || !includeStamp || !rawStampSrc) {
      setProcessedStampUrl(null);
      return;
    }

    setStampFailed(false);
    processSignatureImage(rawStampSrc, autoCleanBg).then((resultUrl) => {
      if (!cancelled) {
        setProcessedStampUrl(resultUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isAktifKuliah, includeStamp, rawStampSrc, autoCleanBg]);

  const service = request ? getLetterService(request.letter_type, services) : undefined;

  async function handleSavePdf() {
    if (!request || request.status !== 'Disetujui' || !letterContentRef.current || savingPdf) {
      return;
    }
    setSavingPdf(true);
    setPdfError('');
    try {
      const titleSlug = (service?.shortTitle || request.letter_type || 'Surat').replace(
        /[^a-zA-Z0-9_-]+/g,
        '_'
      );
      const numberSlug = (request.official_number || request.tracking_code || 'Resmi').replace(
        /[^a-zA-Z0-9_-]+/g,
        '_'
      );
      await downloadLetterAsPdf(
        letterContentRef.current,
        `${titleSlug}_${request.student_nim}_${numberSlug}.pdf`
      );
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Gagal menyimpan file PDF.');
    } finally {
      setSavingPdf(false);
    }
  }

  useEffect(() => {
    if (
      !request ||
      !autoDownloadPdf ||
      request.status !== 'Disetujui' ||
      autoDownloadedRef.current
    ) {
      return;
    }

    const sigReady =
      !isAktifKuliah || !includeSignature || !rawSignatureSrc || sigFailed || processedSigUrl !== null;
    const stampReady =
      !isAktifKuliah || !includeStamp || !rawStampSrc || stampFailed || processedStampUrl !== null;

    if (!sigReady || !stampReady || !letterContentRef.current) return;

    const timer = window.setTimeout(() => {
      if (autoDownloadedRef.current) return;
      autoDownloadedRef.current = true;
      void handleSavePdf().finally(() => {
        onAutoDownloadDone?.();
      });
    }, 150);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    request,
    autoDownloadPdf,
    isAktifKuliah,
    includeSignature,
    rawSignatureSrc,
    sigFailed,
    processedSigUrl,
    includeStamp,
    rawStampSrc,
    stampFailed,
    processedStampUrl,
  ]);

  if (!request) return null;

  function handleSelectLocalSignature(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomSigFileUrl(reader.result);
        setCustomSigLabel(file.name);
        setIncludeSignature(true);
        setSigFailed(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleSelectLocalStamp(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomStampFileUrl(reader.result);
        setCustomStampLabel(file.name);
        setIncludeStamp(true);
        setStampFailed(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const student = request.student;
  const f = request.form_data || {};
  const letterDateRaw = request.verified_at || request.updated_at || request.created_at;
  const letterDateObj = (() => {
    const d = letterDateRaw ? new Date(letterDateRaw) : new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();
  const tanggalTerbit = formatTanggalLengkap(letterDateRaw);
  const draftRomanMonth = getRomanMonth(letterDateObj);
  const draftYear = letterDateObj.getFullYear();

  const tempatLahir = f.tempat_lahir || student?.tempat_lahir || '-';
  const rawTanggalLahir = f.tanggal_lahir || student?.tanggal_lahir || '';
  const tanggalLahirFormatted = rawTanggalLahir ? formatTanggalLengkap(rawTanggalLahir) : '-';
  const ttlText =
    tempatLahir !== '-' && tanggalLahirFormatted !== '-'
      ? `${tempatLahir}, ${tanggalLahirFormatted}`
      : tempatLahir !== '-'
      ? tempatLahir
      : tanggalLahirFormatted;

  const signatoryName = request.signatory_name || tpl.signatory_name;
  const signatoryNidn = request.signatory_nidn || tpl.signatory_nidn;
  const signatoryTitle = request.signatory_title || tpl.signatory_title;
  const signatoryNik = request.signatory_nik || tpl.signatory_nik;
  const builtinSet = new Set(BUILTIN_FIELD_NAMES[request.letter_type] || []);
  const extraCustomFields = (service?.formFields || []).filter(
    (field) => !builtinSet.has(field.name) && f[field.name]
  );

  const displaySignatureUrl = processedSigUrl || rawSignatureSrc;
  const showEmbeddedSignature =
    isAktifKuliah && includeSignature && Boolean(displaySignatureUrl) && !sigFailed;

  const displayStampUrl = processedStampUrl || rawStampSrc;
  const showEmbeddedStamp =
    isAktifKuliah && includeStamp && Boolean(displayStampUrl) && !stampFailed;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 overflow-y-auto print:static print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Pratinjau Surat Resmi"
    >
      <div className="w-full max-w-4xl bg-white border border-amber-200 rounded-lg shadow-2xl overflow-hidden my-auto print-only-letter">
        <div className="no-print flex items-center justify-end gap-2 px-6 py-3.5 border-b border-amber-200 bg-amber-50/70">
          <div className="flex items-center gap-2 shrink-0">
            {request.status === 'Disetujui' && (
              <button
                type="button"
                onClick={() => void handleSavePdf()}
                disabled={savingPdf}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                title="Simpan Surat Resmi sebagai PDF"
              >
                {savingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{savingPdf ? 'Menyimpan PDF...' : 'Simpan PDF'}</span>
              </button>
            )}


            <button
              type="button"
              onClick={onClose}
              className="p-2 text-stone-600 hover:text-stone-950 hover:bg-amber-200/60 rounded-md transition-colors"
              aria-label="Tutup surat resmi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {pdfError && (
          <div className="no-print px-6 py-2.5 bg-red-50 border-b border-red-200 text-xs text-red-800">
            {pdfError}
          </div>
        )}

        {isAktifKuliah && isStaff && (
          <div className="no-print px-6 py-3 border-b border-amber-200 bg-orange-50/60 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 font-semibold text-stone-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeSignature}
                    onChange={(e) => setIncludeSignature(e.target.checked)}
                    className="rounded border-amber-300 text-orange-600 focus:ring-orange-600"
                  />
                  <PenTool className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                  <span>Sisipkan tanda tangan pada PDF</span>
                </label>

                <label className="inline-flex items-center gap-2 font-semibold text-stone-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeStamp}
                    onChange={(e) => setIncludeStamp(e.target.checked)}
                    className="rounded border-amber-300 text-orange-600 focus:ring-orange-600"
                  />
                  <Stamp className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                  <span>Sisipkan stempel Dekan pada PDF</span>
                </label>

                {(includeSignature || includeStamp) && (
                  <label className="inline-flex items-center gap-1.5 text-stone-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCleanBg}
                      onChange={(e) => setAutoCleanBg(e.target.checked)}
                      className="rounded border-amber-300 text-orange-600 focus:ring-orange-600"
                    />
                    <span>Bersihkan latar otomatis</span>
                  </label>
                )}
              </div>

              {(includeSignature || includeStamp) && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={sigFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleSelectLocalSignature}
                    className="sr-only"
                  />
                  <input
                    ref={stampFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleSelectLocalStamp}
                    className="sr-only"
                  />

                  {includeSignature && (
                    <>
                      <button
                        type="button"
                        onClick={() => sigFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors whitespace-nowrap"
                      >
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          {customSigLabel
                            ? `TTD: ${customSigLabel.slice(0, 14)}`
                            : 'Pilih File Tanda Tangan'}
                        </span>
                      </button>
                      {customSigFileUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomSigFileUrl(null);
                            setCustomSigLabel(null);
                            setSigFailed(false);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors whitespace-nowrap"
                          title="Kembali ke Tanda Tangan Dekan bawaan"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          <span>Reset TTD</span>
                        </button>
                      )}
                    </>
                  )}

                  {includeStamp && (
                    <>
                      <button
                        type="button"
                        onClick={() => stampFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors whitespace-nowrap"
                      >
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          {customStampLabel
                            ? `Stempel: ${customStampLabel.slice(0, 14)}`
                            : 'Pilih File Stempel'}
                        </span>
                      </button>
                      {customStampFileUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomStampFileUrl(null);
                            setCustomStampLabel(null);
                            setStampFailed(false);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors whitespace-nowrap"
                          title="Kembali ke Stempel Dekan bawaan"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          <span>Reset Stempel</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div
          ref={letterContentRef}
          className="relative p-8 md:px-14 md:py-10 print:p-2 bg-white text-slate-950 text-[13.5px] leading-[1.55] font-sans overflow-hidden"
        >
          {/* Watermark Lambang Universitas Kaltara di Tengah Surat (sesuai contoh resmi) */}
          {isAktifKuliah && !emblemFailed && (
            <div
              aria-hidden="true"
              className="pointer-events-none select-none absolute inset-0 flex items-center justify-center pt-20 z-0"
            >
              <img
                src={DEFAULT_UNIVERSITY_LOGO_URL}
                alt=""
                referrerPolicy="no-referrer"
                className="w-[340px] h-[340px] object-contain opacity-[0.12] mix-blend-multiply"
              />
            </div>
          )}

          <div className="relative z-10">
            {/* Kop Surat Resmi Universitas Kaltara Fakultas Ekonomi */}
            <div className="flex items-center gap-4 pb-2 border-b-[3px] border-double border-slate-950">
              <div className="shrink-0 flex items-center justify-center" style={{ width: '2.83cm', height: '2.8cm' }}>
                {!emblemFailed ? (
                  <img
                    src={DEFAULT_UNIVERSITY_LOGO_URL}
                    alt="Lambang Universitas Kaltara"
                    referrerPolicy="no-referrer"
                    onError={() => setEmblemFailed(true)}
                    className="object-contain mix-blend-multiply"
                    style={{ width: '2.83cm', height: '2.8cm' }}
                  />
                ) : (
                  <div className="border-2 border-slate-900 rounded-full flex items-center justify-center font-display font-bold text-slate-900 text-base" style={{ width: '2.83cm', height: '2.8cm' }}>
                    UK
                  </div>
                )}
              </div>
              <div className="flex-1 text-center pr-4 font-serif">
                <p className="tracking-wide text-slate-950 uppercase leading-tight text-[16px]">
                  {tpl.institution_foundation}
                </p>
                <p className="tracking-wide text-slate-950 uppercase mt-0.5 leading-tight text-[16px]">
                  {tpl.institution_university}
                </p>
                <h2 className="font-bold tracking-wide text-slate-950 uppercase leading-tight mt-0.5 text-[16px]">
                  {tpl.institution_faculty}
                </h2>
                <p className="text-[11px] text-slate-900 mt-1 font-sans">{tpl.institution_address}</p>
              </div>
            </div>

            {/* Judul & Nomor Surat */}
            <div className="text-center mt-5 mb-6">
              <h3 className="text-[16px] font-bold underline underline-offset-4 decoration-2 tracking-wide text-slate-950 uppercase">
                {service?.letterSubject || 'SURAT KETERANGAN AKTIF KULIAH'}
              </h3>
              <p className="text-[13.5px] text-slate-950 mt-0.5">
                Nomor :{' '}
                {request.official_number ||
                  `DRAFT/${tpl.number_middle_code}/${draftRomanMonth}/${draftYear}`}
              </p>
            </div>

            {/* Yang bertanda tangan di bawah ini */}
            <p className="mb-3 ml-2">Yang bertanda tangan di bawah ini :</p>
            <table className="w-full max-w-2xl mb-4 text-[13.5px] ml-10">
              <tbody>
                <tr>
                  <td className="py-0.5 w-56 text-slate-950">Nama</td>
                  <td className="py-0.5 w-5 text-center">:</td>
                  <td className="py-0.5 text-slate-950">{signatoryName}</td>
                </tr>
                <tr>
                  <td className="py-0.5 text-slate-950">NIDN</td>
                  <td className="py-0.5 text-center">:</td>
                  <td className="py-0.5 text-slate-950 tabular-nums">{signatoryNidn}</td>
                </tr>
                <tr>
                  <td className="py-0.5 text-slate-950">Jabatan</td>
                  <td className="py-0.5 text-center">:</td>
                  <td className="py-0.5 text-slate-950">{signatoryTitle}</td>
                </tr>
              </tbody>
            </table>

            {request.letter_type === 'AKTIF_KULIAH' ? (
              <>
                <p className="mb-3 ml-2">Menerangkan bahwa :</p>
                <table className="w-full max-w-2xl mb-4 text-[13.5px] ml-10">
                  <tbody>
                    <tr>
                      <td className="py-0.5 w-56 text-slate-950">Nama Mahasiswa</td>
                      <td className="py-0.5 w-5 text-center">:</td>
                      <td className="py-0.5 font-bold uppercase text-slate-950">
                        {student?.nama || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Nomor Induk Kependudukan</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 text-slate-950 tabular-nums">
                        {f.nik || student?.nik || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Nomor Pokok Mahasiswa</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 text-slate-950 tabular-nums">{request.student_nim}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Tempat, Tanggal Lahir</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 text-slate-950">{ttlText}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Jenis Kelamin</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 text-slate-950">
                        {f.jenis_kelamin || student?.jenis_kelamin || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950 align-top">Alamat</td>
                      <td className="py-0.5 text-center align-top">:</td>
                      <td className="py-0.5 text-slate-950 whitespace-pre-line">
                        {f.alamat || student?.alamat || '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <p className="mb-3 ml-2">Merupakan mahasiswa aktif :</p>
                <table className="w-full max-w-2xl mb-4 text-[13.5px] ml-10">
                  <tbody>
                    <tr>
                      <td className="py-0.5 w-56 text-slate-950">Jenjang</td>
                      <td className="py-0.5 w-5 text-center">:</td>
                      <td className="py-0.5 uppercase text-slate-950">
                        {(f.jenjang || student?.jenjang || 'SARJANA (S1)').replace(/^\d+\s*-\s*/, '') === 'S1'
                          ? 'SARJANA (S1)'
                          : (f.jenjang || student?.jenjang || 'SARJANA (S1)').replace(/^\d+\s*-\s*/, '')}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Program Studi</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 uppercase text-slate-950">
                        {(student?.prodi || '-').replace(/^\d+\s*-\s*/, '')}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Memulai studi pada</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 text-slate-950">
                        {f.mulai_studi || formatMulaiStudiText(student) || '-'}
                      </td>
                    </tr>
                    {extraCustomFields.map((cf) => (
                      <tr key={cf.name}>
                        <td className="py-0.5 text-slate-950">{cf.label}</td>
                        <td className="py-0.5 text-center">:</td>
                        <td className="py-0.5 text-slate-950">{f[cf.name]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="mb-7 ml-10 mr-4 text-justify leading-relaxed">
                  Demikian surat keterangan ini dibuat untuk keperluan{' '}
                  <span className="font-bold">
                    {(f.keperluan || 'administrasi akademik')
                      .trim()
                      .replace(/\.+$/, '')
                      .replace(/^Persyaratan\s+/i, 'persyaratan ')}
                    .
                  </span>
                </p>
              </>
            ) : (
              <>
                <p className="mb-3 ml-2">Menerangkan bahwa mahasiswa yang tercantum di bawah ini :</p>
                <table className="w-full max-w-2xl mb-5 text-[13.5px] ml-10">
                  <tbody>
                    <tr>
                      <td className="py-0.5 w-56 text-slate-950">Nama Mahasiswa</td>
                      <td className="py-0.5 w-5 text-center">:</td>
                      <td className="py-0.5 font-bold uppercase text-slate-950">
                        {student?.nama || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Nomor Pokok Mahasiswa</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 text-slate-950 tabular-nums">{request.student_nim}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Program Studi</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 uppercase text-slate-950">
                        {(student?.prodi || '-').replace(/^\d+\s*-\s*/, '')}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Fakultas</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 text-slate-950">
                        {student?.fakultas || 'Fakultas Ekonomi'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-0.5 text-slate-950">Semester / Angkatan</td>
                      <td className="py-0.5 text-center">:</td>
                      <td className="py-0.5 tabular-nums">
                        Semester {student?.semester || '-'} / Angkatan {student?.angkatan || '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {request.letter_type === 'MAGANG_PKL' && (
                  <div className="space-y-3 mb-6 ml-10 text-justify">
                    <p>
                      Bermaksud mengajukan permohonan pelaksanaan Praktik Kerja Lapangan (PKL) / Magang
                      Akademik pada <span className="font-semibold">{f.nama_instansi || '-'}</span>{' '}
                      (ditujukan kepada {f.jabatan_penerima || 'Pimpinan Instansi'}), beralamat di{' '}
                      {f.alamat_instansi || '-'}.
                    </p>
                    <p>
                      Kegiatan direncanakan berlangsung pada periode{' '}
                      <span className="font-semibold tabular-nums">
                        {formatTanggalLengkap(f.tanggal_mulai)} s.d.{' '}
                        {formatTanggalLengkap(f.tanggal_selesai)}
                      </span>{' '}
                      dengan fokus bidang <span className="font-semibold">{f.bidang_magang || '-'}</span>.
                    </p>
                  </div>
                )}

                {request.letter_type === 'IZIN_PENELITIAN' && (
                  <div className="space-y-3 mb-6 ml-10 text-justify">
                    <p>
                      Adalah benar mahasiswa tingkat akhir yang sedang menyusun tugas akhir/skripsi
                      dengan judul: <span className="font-semibold">“{f.judul_penelitian || '-'}”</span>{' '}
                      di bawah bimbingan {f.dosen_pembimbing || '-'}.
                    </p>
                    <p>
                      Dengan ini kami memohon perkenan {f.pimpinan_tujuan || 'Pimpinan'} pada{' '}
                      <span className="font-semibold">{f.lokasi_penelitian || '-'}</span> untuk
                      memberikan izin pengambilan data dan observasi penelitian pada periode{' '}
                      <span className="font-semibold">{f.periode_penelitian || '-'}</span>.
                    </p>
                  </div>
                )}

                {request.letter_type === 'REKOMENDASI_BEASISWA' && (
                  <div className="space-y-3 mb-6 ml-10 text-justify">
                    <p>
                      Direkomendasikan untuk mengikuti seleksi program beasiswa{' '}
                      <span className="font-semibold">{f.nama_beasiswa || '-'}</span> yang
                      diselenggarakan oleh <span className="font-semibold">{f.penyelenggara || '-'}</span>.
                    </p>
                    <p>
                      Berdasarkan catatan akademik terakhir, mahasiswa memiliki Indeks Prestasi
                      Kumulatif (IPK) sebesar{' '}
                      <span className="font-semibold tabular-nums">
                        {f.ipk_terakhir || student?.ipk}
                      </span>{' '}
                      serta catatan prestasi/aktivitas: {f.prestasi_pendukung || '-'}.
                    </p>
                  </div>
                )}

                {request.letter_type === 'KETERANGAN_LULUS' && (
                  <div className="space-y-3 mb-6 ml-10 text-justify">
                    <p>
                      Telah dinyatakan lulus pada sidang yudisium tanggal{' '}
                      <span className="font-semibold tabular-nums">
                        {formatTanggalLengkap(f.tanggal_yudisium)}
                      </span>{' '}
                      dengan judul tugas akhir{' '}
                      <span className="font-semibold">“{f.judul_tugas_akhir || '-'}”</span>.
                    </p>
                    <p>
                      Mahasiswa yang bersangkutan memperoleh IPK Akhir{' '}
                      <span className="font-semibold tabular-nums">
                        {f.ipk_akhir || student?.ipk}
                      </span>{' '}
                      dengan predikat kelulusan{' '}
                      <span className="font-semibold">{f.predikat || '-'}</span>. Surat ini berlaku
                      sebagai keterangan resmi sementara sebelum ijazah asli diterbitkan.
                    </p>
                  </div>
                )}

                {request.letter_type === 'IZIN_OBSERVASI' && (() => {
                  const isKelompok = (f.jenis_observasi || '').toLowerCase().includes('kelompok');
                  return (
                    <div className="space-y-3 mb-6 ml-10 text-justify">
                      <p>
                        Adalah benar mahasiswa aktif Fakultas Ekonomi Universitas Kaltara yang
                        bermaksud melaksanakan kegiatan observasi lapangan{' '}
                        <span className="font-semibold">
                          {isKelompok ? 'secara berkelompok' : 'secara individu'}
                        </span>{' '}
                        untuk keperluan <span className="font-semibold">{f.mata_kuliah || '-'}</span>{' '}
                        dengan topik <span className="font-semibold">“{f.topik_observasi || '-'}”</span>
                        {f.dosen_pengampu ? ` di bawah bimbingan/arahan ${f.dosen_pengampu}` : ''}.
                      </p>
                      {isKelompok && f.anggota_kelompok && (
                        <div className="bg-slate-50/70 border border-slate-200 rounded px-4 py-2.5 text-[13px] leading-relaxed">
                          <p className="font-semibold text-slate-900 mb-1">
                            Daftar Anggota Kelompok Observasi (Selain Pemohon Utama):
                          </p>
                          <p className="whitespace-pre-line text-slate-900">{f.anggota_kelompok}</p>
                        </div>
                      )}
                      <p>
                        Sehubungan dengan hal tersebut, kami memohon perkenan{' '}
                        <span className="font-semibold">{f.pimpinan_tujuan || 'Pimpinan'}</span> pada{' '}
                        <span className="font-semibold">{f.nama_instansi || '-'}</span> (
                        {f.alamat_instansi || '-'}) untuk memberikan izin pelaksanaan observasi{' '}
                        {isKelompok ? 'kelompok ' : ''}pada periode{' '}
                        <span className="font-semibold">{f.periode_observasi || '-'}</span>.
                      </p>
                    </div>
                  );
                })()}

                {request.letter_type === 'PINDAH_KULIAH' && (
                  <div className="space-y-3 mb-6 ml-10 text-justify">
                    <p>
                      Adalah benar mahasiswa jenjang{' '}
                      <span className="font-semibold uppercase">
                        {(f.jenjang || student?.jenjang || 'SARJANA (S1)').replace(/^\d+\s*-\s*/, '')}
                      </span>{' '}
                      Program Studi{' '}
                      <span className="font-semibold uppercase">
                        {(student?.prodi || '-').replace(/^\d+\s*-\s*/, '')}
                      </span>{' '}
                      dengan semester terakhir ditempuh{' '}
                      <span className="font-semibold">{f.semester_terakhir || '-'}</span>, yang telah
                      mengajukan permohonan pindah kuliah ke{' '}
                      <span className="font-semibold">{f.kampus_tujuan || '-'}</span> pada{' '}
                      <span className="font-semibold">{f.fakultas_prodi_tujuan || '-'}</span>.
                    </p>
                    <p>
                      Permohonan pindah kuliah diajukan dengan alasan:{' '}
                      <span className="font-semibold">{f.alasan_pindah || '-'}</span>. Mahasiswa
                      yang bersangkutan telah menyelesaikan seluruh kewajiban administrasi akademik
                      dan keuangan pada Fakultas Ekonomi Universitas Kaltara.
                    </p>
                  </div>
                )}

                {extraCustomFields.length > 0 && (
                  <table className="w-full max-w-2xl mb-5 text-[13.5px] ml-10">
                    <tbody>
                      {extraCustomFields.map((cf) => (
                        <tr key={cf.name}>
                          <td className="py-0.5 w-56 text-slate-950">{cf.label}</td>
                          <td className="py-0.5 w-5 text-center">:</td>
                          <td className="py-0.5 text-slate-950">{f[cf.name]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <p className="mb-8 ml-10 text-justify">
                  Demikian surat ini dibuat dengan sebenarnya berdasarkan data akademik yang telah
                  diverifikasi secara digital oleh Layanan Administrasi Akademik Fakultas Ekonomi
                  Universitas Kaltara untuk dapat dipergunakan sebagaimana mestinya.
                </p>
              </>
            )}

            {/* Footer Tanda Tangan Dekan & Stempel */}
            <div
              className={`flex flex-col sm:flex-row sm:items-end gap-6 pt-2 ${
                isAktifKuliah ? 'justify-end pr-4 sm:pr-10' : 'justify-between'
              }`}
            >
              {!isAktifKuliah && (
                <div className="border border-slate-200 rounded p-3 bg-slate-50/70 max-w-xs">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                    <span>Terverifikasi Secara Digital</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Kode Registrasi: <span className="font-mono">{request.tracking_code}</span>
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Diverifikasi oleh: {request.verified_by || 'Staf Administrasi Akademik'}
                  </p>
                  <p className="text-[11px] text-slate-600 tabular-nums">
                    Tanggal Verifikasi: {tanggalTerbit}
                  </p>
                </div>
              )}

              <div className="relative text-left min-w-[270px] pl-12">
                {showEmbeddedStamp && (
                  <img
                    src={displayStampUrl}
                    alt="Stempel Dekan Fakultas Ekonomi Universitas Kaltara"
                    onError={() => setStampFailed(true)}
                    className="absolute -left-8 -top-3 w-36 h-36 object-contain pointer-events-none select-none mix-blend-multiply opacity-90 z-10"
                  />
                )}
                <p className="text-slate-950 relative z-0">
                  {tpl.letter_city}, {tanggalTerbit}
                </p>
                <p className="text-slate-950 uppercase mt-0.5 relative z-0">
                  {tpl.signatory_role_heading}
                </p>
                <div className="h-14 flex items-center relative z-20">
                  {showEmbeddedSignature ? (
                    <img
                      src={displaySignatureUrl}
                      alt={`Tanda tangan ${signatoryName}`}
                      onError={() => setSigFailed(true)}
                      className="h-16 max-w-[190px] -ml-1 -mt-1 object-contain select-none"
                    />
                  ) : (
                    <span className="no-print text-xs font-mono text-slate-400 border border-dashed border-slate-300 px-3 py-1 rounded">
                      Ditandatangani Secara Elektronik
                    </span>
                  )}
                </div>
                <p className="font-bold text-slate-950 underline underline-offset-2 uppercase whitespace-nowrap relative z-0">
                  {signatoryName}
                </p>
                <p className="text-[13px] text-slate-950 mt-0.5 tabular-nums relative z-0">
                  NIK. {signatoryNik}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
