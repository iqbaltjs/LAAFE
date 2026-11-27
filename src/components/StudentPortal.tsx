import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  FilePlus2,
  FileText,
  History,
  Loader2,
  Lock,
  LogOut,
  Menu,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  apiRequest,
  apiUpload,
  fetchProtectedBlob,
  formatBytes,
  formatTanggalIndonesia,
} from '../lib/api';
import {
  DEFAULT_LETTER_SETTINGS,
  DEFAULT_UNIVERSITY_LOGO_URL,
  LETTER_SERVICES,
  formatMulaiStudiText,
  getLetterService,
  getMissingStudentFields,
  resolveFormFieldInitialValue,
  type LetterRequest,
  type LetterServiceDefinition,
  type LetterTemplateSettings,
  type StudentRecord,
  type UploadedDocument,
} from '../shared/types';
import { DocumentViewerModal, type CustomDocumentSource } from './DocumentViewerModal';
import { OfficialLetterModal } from './OfficialLetterModal';
import { PWAInstallButton } from './PWAInstallButton';
import { StatusIndicator } from './StatusIndicator';

interface StudentPortalProps {
  token: string;
  student: StudentRecord;
  onStudentUpdated?: (student: StudentRecord) => void;
  onLogout: () => void;
}

type StudentTab = 'services' | 'history';

export function StudentPortal({
  token,
  student,
  onStudentUpdated,
  onLogout,
}: StudentPortalProps) {
  const [tab, setTab] = useState<StudentTab>('services');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Requests history state
  const [requests, setRequests] = useState<LetterRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [historyFilter, setHistoryFilter] = useState<string>('ALL');
  const [historySearch, setHistorySearch] = useState('');

  // New request wizard state
  const [selectedService, setSelectedService] = useState<LetterServiceDefinition | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [slotFiles, setSlotFiles] = useState<Record<string, File | null>>({});
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitBanner, setSubmitBanner] = useState<string | null>(null);

  // Detail & Revision state
  const [activeDetail, setActiveDetail] = useState<LetterRequest | null>(null);
  const [revisingRequest, setRevisingRequest] = useState<LetterRequest | null>(null);
  const [revisionFormValues, setRevisionFormValues] = useState<Record<string, string>>({});
  const [revisionFiles, setRevisionFiles] = useState<File[]>([]);
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);

  // Step 2 Upload state (for PINDAH_KULIAH Menunggu Berkas / Perlu Revisi)
  const [step2SlotFiles, setStep2SlotFiles] = useState<Record<string, File | null>>({});
  const [step2ExtraFiles, setStep2ExtraFiles] = useState<File[]>([]);
  const [uploadingStep2, setUploadingStep2] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Dynamic Services & Template Settings
  const [services, setServices] = useState<LetterServiceDefinition[]>(LETTER_SERVICES);
  const [templateSettings, setTemplateSettings] = useState<LetterTemplateSettings>(
    DEFAULT_LETTER_SETTINGS
  );

  // Modals
  const [previewDoc, setPreviewDoc] = useState<UploadedDocument | null>(null);
  const [manualPdfPreview, setManualPdfPreview] = useState<CustomDocumentSource | null>(null);
  const [officialLetterReq, setOfficialLetterReq] = useState<LetterRequest | null>(null);
  const [autoDownloadPdf, setAutoDownloadPdf] = useState(false);

  // Student Profile Completion state
  const missingProfileFields = useMemo(() => getMissingStudentFields(student), [student]);
  const [showBiodataModal, setShowBiodataModal] = useState(false);
  const [biodataDraft, setBiodataDraft] = useState({
    nik: student.nik || '',
    tempat_lahir: student.tempat_lahir || '',
    tanggal_lahir: student.tanggal_lahir || '',
    jenis_kelamin: student.jenis_kelamin || '',
    jenjang: student.jenjang || 'SARJANA (S1)',
    email: student.email || '',
    no_hp: student.no_hp || '',
    alamat: student.alamat || '',
  });
  const [savingBiodata, setSavingBiodata] = useState(false);
  const [biodataError, setBiodataError] = useState<string | null>(null);

  function openBiodataModal() {
    setBiodataDraft({
      nik: student.nik || '',
      tempat_lahir: student.tempat_lahir || '',
      tanggal_lahir: student.tanggal_lahir || '',
      jenis_kelamin: student.jenis_kelamin || '',
      jenjang: student.jenjang || 'SARJANA (S1)',
      email: student.email || '',
      no_hp: student.no_hp || '',
      alamat: student.alamat || '',
    });
    setBiodataError(null);
    setShowBiodataModal(true);
  }

  async function handleSaveBiodata(e: FormEvent) {
    e.preventDefault();
    setBiodataError(null);
    setSavingBiodata(true);
    try {
      const res = await apiRequest<{ student: StudentRecord }>('/api/student/profile', {
        method: 'PUT',
        token,
        body: biodataDraft,
      });
      onStudentUpdated?.(res.student);
      setShowBiodataModal(false);
      setSubmitBanner('Biodata mahasiswa berhasil disimpan dan diperbarui.');
    } catch (err) {
      setBiodataError(err instanceof Error ? err.message : 'Gagal menyimpan biodata.');
    } finally {
      setSavingBiodata(false);
    }
  }

  const fetchServicesConfig = useCallback(async () => {
    try {
      const res = await apiRequest<{
        services: LetterServiceDefinition[];
        templateSettings: LetterTemplateSettings;
      }>('/api/services');
      if (Array.isArray(res.services) && res.services.length > 0) {
        setServices(res.services);
      }
      if (res.templateSettings) {
        setTemplateSettings(res.templateSettings);
      }
    } catch {
      // keep fallback defaults
    }
  }, []);

  const fetchMyRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const res = await apiRequest<{ requests: LetterRequest[] }>('/api/requests/mine', {
        token,
      });
      setRequests(res.requests);
    } catch {
      // handled silently or in UI
    } finally {
      setLoadingRequests(false);
    }
  }, [token]);

  useEffect(() => {
    fetchServicesConfig();
    fetchMyRequests();
  }, [fetchServicesConfig, fetchMyRequests]);

  useEffect(() => {
    setStep2SlotFiles({});
    setStep2ExtraFiles([]);
    setStep2Error(null);
  }, [activeDetail?.id]);

  function openManualPdfPreview(req: LetterRequest) {
    setManualPdfPreview({
      url: `/api/requests/${req.id}/manual-letter-pdf`,
      title: `Surat Pindah Kuliah (PDF Resmi) · ${req.tracking_code}`,
      fileName: req.manual_pdf_name || `Surat_Pindah_${req.student_nim}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: req.manual_pdf_size || 0,
    });
  }

  async function handleDownloadManualPdf(req: LetterRequest) {
    try {
      const blob = await fetchProtectedBlob(
        `/api/requests/${req.id}/manual-letter-pdf?download=1`,
        token
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = req.manual_pdf_name || `Surat_Pindah_${req.student_nim}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSubmitBanner(
        err instanceof Error ? err.message : 'Gagal mengunduh file PDF Surat Pindah.'
      );
    }
  }

  function startServiceForm(service: LetterServiceDefinition) {
    const initialForm: Record<string, string> = {};
    for (const field of service.formFields) {
      initialForm[field.name] = resolveFormFieldInitialValue(field, student);
    }
    setSelectedService(service);
    setFormValues(initialForm);
    setSlotFiles({});
    setExtraFiles([]);
    setFormError(null);
  }

  async function submitNewRequestWithMode(submitMode: 'full' | 'step1_only') {
    if (!selectedService) return;
    setFormError(null);

    const payloadFormValues: Record<string, string> = { ...formValues };
    if (selectedService.id === 'AKTIF_KULIAH') {
      const autoStartStudy = formatMulaiStudiText(student);
      if (autoStartStudy) {
        payloadFormValues.mulai_studi = autoStartStudy;
      }
    }

    if (selectedService.id === 'IZIN_OBSERVASI') {
      if (payloadFormValues.jenis_observasi !== 'Observasi Kelompok') {
        payloadFormValues.anggota_kelompok = '';
      } else if (!payloadFormValues.anggota_kelompok?.trim()) {
        setFormError('Kolom "Daftar Nama & NPM Anggota Kelompok" wajib diisi untuk observasi kelompok.');
        return;
      }
    }

    for (const field of selectedService.formFields) {
      if (selectedService.id === 'AKTIF_KULIAH' && field.name === 'mulai_studi') {
        continue;
      }
      if (
        selectedService.id === 'IZIN_OBSERVASI' &&
        field.name === 'anggota_kelompok' &&
        payloadFormValues.jenis_observasi !== 'Observasi Kelompok'
      ) {
        continue;
      }
      if (field.required && !payloadFormValues[field.name]?.trim()) {
        setFormError(`Kolom "${field.label}" wajib diisi.`);
        return;
      }
    }

    const isStep1DraftOnly = selectedService.id === 'PINDAH_KULIAH' && submitMode === 'step1_only';
    const filesToSend: { file: File; docType: string }[] = [];

    if (!isStep1DraftOnly) {
      for (const docDef of selectedService.requiredDocuments) {
        const file = slotFiles[docDef.id];
        if (docDef.required && !file) {
          setFormError(`Dokumen "${docDef.label}" wajib diunggah.`);
          return;
        }
        if (file) {
          filesToSend.push({ file, docType: docDef.label });
        }
      }
      for (const ef of extraFiles) {
        filesToSend.push({ file: ef, docType: 'Dokumen Tambahan' });
      }

      if (selectedService.requiredDocuments.length > 0 && filesToSend.length === 0) {
        setFormError('Unggah minimal satu dokumen pendukung.');
        return;
      }
    }

    const fd = new FormData();
    fd.append('letter_type', selectedService.id);
    fd.append('submit_mode', isStep1DraftOnly ? 'step1_only' : 'full');
    fd.append('form_data', JSON.stringify(payloadFormValues));
    fd.append('doc_types', JSON.stringify(filesToSend.map((item) => item.docType)));
    for (const item of filesToSend) {
      fd.append('files', item.file);
    }

    setSubmitting(true);
    try {
      const res = await apiUpload<{ request: LetterRequest }>('/api/requests', fd, token);
      if (res.request.student) {
        onStudentUpdated?.(res.request.student);
      }
      setRequests((prev) => [res.request, ...prev]);
      setSelectedService(null);
      setTab('history');
      if (isStep1DraftOnly) {
        setActiveDetail(res.request);
        setSubmitBanner(
          `Langkah 1 (${res.request.tracking_code}) tersimpan. Silakan unduh, tanda tangani, dan stempel 3 berkas, lalu unggah kembali pada Langkah 2 di bawah ini.`
        );
      } else {
        setSubmitBanner(
          `Pengajuan ${res.request.tracking_code} (${selectedService.shortTitle}) berhasil dikirim dan sedang menunggu verifikasi staf.`
        );
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal mengirim pengajuan surat.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitNewRequest(e: FormEvent) {
    e.preventDefault();
    await submitNewRequestWithMode('full');
  }

  async function handleSubmitStep2Upload(e: FormEvent) {
    e.preventDefault();
    if (!activeDetail) return;
    setStep2Error(null);

    const srv = getLetterService(activeDetail.letter_type, services);
    const reqDocs = srv?.requiredDocuments || [];
    const existingTypes = new Set(
      (activeDetail.documents || []).map((d) => String(d.doc_type || '').trim())
    );

    const filesToSend: { file: File; docType: string }[] = [];
    for (const docDef of reqDocs) {
      const picked = step2SlotFiles[docDef.id] || null;
      if (picked) {
        filesToSend.push({ file: picked, docType: docDef.label });
      } else if (docDef.required && !existingTypes.has(docDef.label)) {
        setStep2Error(`Berkas "${docDef.label}" yang telah ditandatangani & distempel wajib diunggah.`);
        return;
      }
    }
    for (const ef of step2ExtraFiles) {
      filesToSend.push({ file: ef, docType: 'Dokumen Tambahan' });
    }

    if (filesToSend.length === 0) {
      setStep2Error('Pilih minimal satu berkas yang telah lengkap sebelum mengirim.');
      return;
    }

    const fd = new FormData();
    fd.append('doc_types', JSON.stringify(filesToSend.map((item) => item.docType)));
    for (const item of filesToSend) {
      fd.append('files', item.file);
    }

    setUploadingStep2(true);
    try {
      const res = await apiUpload<{ request: LetterRequest }>(
        `/api/requests/${activeDetail.id}/upload-documents`,
        fd,
        token
      );
      setRequests((prev) => prev.map((r) => (r.id === res.request.id ? res.request : r)));
      setActiveDetail(res.request);
      setStep2SlotFiles({});
      setStep2ExtraFiles([]);
      setSubmitBanner(
        `3 berkas Langkah 2 untuk ${res.request.tracking_code} berhasil diunggah dan diteruskan ke verifikasi staf.`
      );
    } catch (err) {
      setStep2Error(err instanceof Error ? err.message : 'Gagal mengunggah berkas Langkah 2.');
    } finally {
      setUploadingStep2(false);
    }
  }

  function startRevision(req: LetterRequest) {
    const srv = getLetterService(req.letter_type, services);
    const nextValues: Record<string, string> = { ...req.form_data };
    if (srv) {
      for (const field of srv.formFields) {
        if (
          ((field.type === 'select' && field.locked) || field.name === 'mulai_studi') &&
          !String(nextValues[field.name] || '').trim()
        ) {
          nextValues[field.name] = resolveFormFieldInitialValue(field, student);
        }
      }
    }
    setRevisingRequest(req);
    setRevisionFormValues(nextValues);
    setRevisionFiles([]);
    setRevisionError(null);
    setActiveDetail(null);
  }

  async function handleSubmitRevision(e: FormEvent) {
    e.preventDefault();
    if (!revisingRequest) return;
    setRevisionError(null);

    const payloadRevisionValues: Record<string, string> = { ...revisionFormValues };
    if (revisingRequest.letter_type === 'IZIN_OBSERVASI') {
      if (payloadRevisionValues.jenis_observasi !== 'Observasi Kelompok') {
        payloadRevisionValues.anggota_kelompok = '';
      } else if (!payloadRevisionValues.anggota_kelompok?.trim()) {
        setRevisionError('Kolom "Daftar Nama & NPM Anggota Kelompok" wajib diisi untuk observasi kelompok.');
        return;
      }
    }

    const fd = new FormData();
    fd.append('form_data', JSON.stringify(payloadRevisionValues));
    fd.append(
      'doc_types',
      JSON.stringify(revisionFiles.map(() => 'Dokumen Perbaikan / Revisi'))
    );
    for (const f of revisionFiles) {
      fd.append('files', f);
    }

    setSubmittingRevision(true);
    try {
      const res = await apiUpload<{ request: LetterRequest }>(
        `/api/requests/${revisingRequest.id}/resubmit`,
        fd,
        token
      );
      setRequests((prev) => prev.map((r) => (r.id === res.request.id ? res.request : r)));
      setRevisingRequest(null);
      setSubmitBanner(
        `Perbaikan untuk ${res.request.tracking_code} berhasil dikirim ulang untuk verifikasi.`
      );
    } catch (err) {
      setRevisionError(err instanceof Error ? err.message : 'Gagal mengirim revisi pengajuan.');
    } finally {
      setSubmittingRevision(false);
    }
  }

  const filteredRequests = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return requests.filter((r) => {
      if (historyFilter !== 'ALL' && r.status !== historyFilter) return false;
      if (q) {
        const srv = getLetterService(r.letter_type, services);
        const matchCode = r.tracking_code.toLowerCase().includes(q);
        const matchService = srv?.title.toLowerCase().includes(q) || false;
        return matchCode || matchService;
      }
      return true;
    });
  }, [requests, historyFilter, historySearch, services]);

  const counts = useMemo(() => {
    return {
      total: requests.length,
      pending: requests.filter(
        (r) =>
          r.status === 'Menunggu Berkas' ||
          r.status === 'Menunggu Verifikasi' ||
          r.status === 'Sedang Diproses'
      ).length,
      revision: requests.filter((r) => r.status === 'Perlu Revisi').length,
      approved: requests.filter((r) => r.status === 'Disetujui').length,
    };
  }, [requests]);

  return (
    <div className="min-h-screen bg-amber-50/40 flex flex-col lg:flex-row">
      {/* Sidebar Desktop + Mobile Drawer */}
      <aside
        className={`${
          mobileNavOpen ? 'fixed inset-0 z-40 flex' : 'hidden lg:flex'
        } lg:w-[270px] lg:shrink-0 lg:flex-col bg-white border-r border-amber-200`}
      >
        <div className="w-[270px] flex flex-col h-full bg-white">
          <div className="px-5 py-5 border-b border-amber-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={DEFAULT_UNIVERSITY_LOGO_URL}
                alt="Lambang Universitas Kaltara"
                referrerPolicy="no-referrer"
                className="w-10 h-10 object-contain shrink-0 mix-blend-multiply"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-orange-700">Universitas Kaltara</p>
                <h1 className="text-sm font-bold tracking-tight text-stone-950 leading-snug mt-0.5">
                  Layanan Administrasi Akademik Fakultas Ekonomi
                </h1>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="lg:hidden p-1.5 text-stone-500 hover:text-stone-900"
              aria-label="Tutup menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Profil Mahasiswa dari Database Excel */}
          <div className="px-6 py-5 border-b border-amber-200 bg-amber-50/70">
            <p className="text-sm font-semibold text-stone-950">{student.nama}</p>
            <p className="text-xs font-mono text-stone-700 mt-0.5 tabular-nums">
              NPM / NIM: {student.nim}
            </p>
            {student.nik && (
              <p className="text-[11px] font-mono text-stone-600 mt-0.5 tabular-nums">
                NIK: {student.nik}
              </p>
            )}
            <div className="mt-3 space-y-1 text-xs text-stone-700">
              <p>
                {student.jenjang ? `${student.jenjang} · ` : ''}
                {student.prodi}
              </p>
              <p className="text-stone-600">{student.fakultas}</p>
              <p className="pt-1 text-stone-800 tabular-nums">
                Semester {student.semester} · IPK {student.ipk} · {student.status_akademik}
              </p>
            </div>
            <button
              type="button"
              onClick={openBiodataModal}
              className={`mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                missingProfileFields.length > 0
                  ? 'bg-amber-400 border-amber-500 text-amber-950 hover:bg-amber-300'
                  : 'bg-white border-amber-300 text-stone-800 hover:bg-amber-50'
              }`}
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {missingProfileFields.length > 0
                  ? `Lengkapi Biodata (${missingProfileFields.length} kosong)`
                  : 'Perbarui Biodata'}
              </span>
            </button>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Navigasi Portal Mahasiswa">
            <button
              type="button"
              onClick={() => {
                setTab('services');
                setSelectedService(null);
                setRevisingRequest(null);
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'services'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-stone-700 hover:bg-amber-50 hover:text-orange-800'
              }`}
            >
              <FilePlus2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap">Ajukan Surat Baru</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('history');
                setSelectedService(null);
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'history'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-stone-700 hover:bg-amber-50 hover:text-orange-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <History className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">Riwayat Pengajuan</span>
              </span>
              <span
                className={`text-xs font-mono tabular-nums ${
                  tab === 'history' ? 'text-amber-100' : 'text-stone-500'
                }`}
              >
                {counts.total}
              </span>
            </button>
          </nav>

          <div className="p-4 border-t border-amber-200">
            <button
              type="button"
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Keluar Sesi Mahasiswa</span>
            </button>
          </div>
        </div>
        {mobileNavOpen && (
          <div
            className="flex-1 bg-stone-950/40 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract */}
        <header className="h-16 bg-white border-b border-amber-200 px-6 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 -ml-2 text-stone-600 hover:text-stone-900"
              aria-label="Buka menu navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm text-stone-600 truncate">
              <span>Portal Mahasiswa</span>
              <span className="mx-2 text-amber-400">/</span>
              <span className="font-semibold text-stone-950">
                {tab === 'services'
                  ? selectedService
                    ? selectedService.shortTitle
                    : 'Pilih Jenis Layanan'
                  : 'Riwayat & Status Pengajuan'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact className="hidden sm:inline-flex" />
            {tab === 'history' ? (
              <button
                type="button"
                onClick={() => {
                  setTab('services');
                  setSelectedService(null);
                  setRevisingRequest(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 transition-colors whitespace-nowrap shrink-0"
              >
                <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Ajukan Surat</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTab('history');
                  setSelectedService(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 transition-colors whitespace-nowrap shrink-0"
              >
                <History className="w-3.5 h-3.5 text-orange-600" aria-hidden="true" />
                <span>Riwayat ({counts.total})</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8 max-w-6xl w-full mx-auto space-y-6">
          {submitBanner && (
            <div className="flex items-start justify-between gap-4 p-4 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-900">
              <div className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                <span>{submitBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setSubmitBanner(null)}
                className="text-emerald-700 hover:text-emerald-950"
                aria-label="Tutup notifikasi"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {missingProfileFields.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-amber-100/80 border border-amber-300 rounded-md text-amber-950">
              <div className="text-xs leading-relaxed">
                <p className="font-semibold">
                  Biodata Anda belum lengkap ({missingProfileFields.length} kolom masih kosong)
                </p>
                <p className="text-amber-900 mt-0.5">
                  Kolom kosong: {missingProfileFields.map((f) => f.label).join(', ')}. Lengkapi agar
                  pengisian formulir surat terisi otomatis.
                </p>
              </div>
              <button
                type="button"
                onClick={openBiodataModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 shrink-0 self-start sm:self-auto"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Lengkapi Biodata Sekarang</span>
              </button>
            </div>
          )}

          {/* TAB 1: PILIH LAYANAN ATAU FORMULIR */}
          {tab === 'services' && !selectedService && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-stone-950">
                  Pilih Jenis Layanan Persuratan
                </h2>
                <p className="text-sm text-stone-600 mt-1">
                  Data identitas akademik Anda akan terisi otomatis berdasarkan catatan NPM / NIM{' '}
                  <span className="font-mono font-semibold text-orange-700">{student.nim}</span>.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {services.map((service) => (
                  <div
                    key={service.id}
                    className="bg-white border border-amber-200 rounded-lg p-6 flex flex-col justify-between hover:border-orange-300 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs text-stone-500">
                        <span className="font-mono font-semibold text-orange-700">
                          {service.code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{service.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>Estimasi {service.estimatedDays}</span>
                      </div>
                      <h3 className="text-base font-bold text-stone-950 mt-2">
                        {service.title}
                      </h3>
                      <p className="text-sm text-stone-600 mt-2 leading-relaxed">
                        {service.description}
                      </p>

                      <div className="mt-4 pt-4 border-t border-amber-100">
                        {service.requiredDocuments.length > 0 ? (
                          <>
                            <p className="text-xs font-semibold text-stone-700 mb-1.5">
                              Dokumen Pendukung yang Diperlukan:
                            </p>
                            <ul className="space-y-1 text-xs text-stone-600">
                              {service.requiredDocuments.map((doc) => (
                                <li key={doc.id}>
                                  • {doc.label} {doc.required ? '(Wajib)' : '(Opsional)'}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="text-xs text-stone-500">
                            Tanpa unggahan dokumen pendukung (verifikasi langsung melalui data
                            akademik).
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 pt-2">
                      <button
                        type="button"
                        onClick={() => startServiceForm(service)}
                        className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 transition-colors"
                      >
                        Pilih Layanan & Isi Formulir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FORMULIR PENGAJUAN + UNGGAH DOKUMEN */}
          {tab === 'services' && selectedService && (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setSelectedService(null)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 hover:text-orange-900"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Kembali ke Daftar Layanan</span>
                </button>
                <span className="text-xs font-mono text-stone-600">
                  Kode Layanan: {selectedService.code}
                </span>
              </div>

              <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
                <div className="px-6 py-5 border-b border-amber-200 bg-amber-50/70">
                  <h2 className="text-lg font-bold text-stone-950">{selectedService.title}</h2>
                  <p className="text-xs text-stone-600 mt-1">{selectedService.description}</p>
                </div>

                {selectedService.id === 'PINDAH_KULIAH' && (
                  <div className="mx-6 mt-6 p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-2.5">
                    <p className="text-xs font-bold text-amber-950">
                      Alur Pembuatan Surat Pindah Kuliah (3 Langkah)
                    </p>
                    <ol className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-stone-700">
                      <li className="p-3 bg-white border border-amber-200 rounded-md">
                        <span className="font-bold text-orange-700 block">
                          Langkah 1 · Isi Form & Unduh Berkas
                        </span>
                        <span className="mt-1 block">
                          Isi formulir permohonan, lalu unduh 3 berkas resmi di Bagian 03 untuk
                          ditandatangani &amp; distempel secara fisik.
                        </span>
                      </li>
                      <li className="p-3 bg-white border border-amber-200 rounded-md">
                        <span className="font-bold text-orange-700 block">
                          Langkah 2 · Unggah Kembali 3 Berkas
                        </span>
                        <span className="mt-1 block">
                          Setelah 3 berkas ditandatangani &amp; distempel lengkap, unggah kembali ke
                          sistem untuk diverifikasi dan diproses staf.
                        </span>
                      </li>
                      <li className="p-3 bg-white border border-amber-200 rounded-md">
                        <span className="font-bold text-orange-700 block">
                          Langkah 3 · Unduh File PDF Surat Pindah
                        </span>
                        <span className="mt-1 block">
                          Apabila seluruh berkas disetujui untuk diproses, Surat Pindah (file PDF
                          manual dari staf) dapat langsung Anda unduh.
                        </span>
                      </li>
                    </ol>
                  </div>
                )}

                <form onSubmit={handleSubmitNewRequest} className="p-6 space-y-8">
                  {/* Ringkasan Data Otomatis Mahasiswa */}
                  <div>
                    <h3 className="text-xs font-semibold text-stone-700 mb-3">
                      01. Identitas Mahasiswa (Terverifikasi dari Data Excel)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-amber-50/60 border border-amber-200 rounded-md text-xs">
                      <div>
                        <span className="text-stone-500 block">Nama Lengkap</span>
                        <span className="font-semibold text-stone-950 mt-0.5 block">
                          {student.nama}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-500 block">NPM / NIM</span>
                        <span className="font-mono font-semibold text-stone-950 mt-0.5 block">
                          {student.nim}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-500 block">Program Studi / Fakultas</span>
                        <span className="font-semibold text-stone-950 mt-0.5 block">
                          {student.prodi} · {student.fakultas}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Isian Formulir Terkait */}
                  <div>
                    <h3 className="text-xs font-semibold text-stone-700 mb-4">
                      02. Formulir Rincian Permohonan
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {selectedService.formFields.map((field) => {
                        if (selectedService.id === 'AKTIF_KULIAH' && field.name === 'mulai_studi') {
                          return null;
                        }
                        if (
                          selectedService.id === 'IZIN_OBSERVASI' &&
                          field.name === 'anggota_kelompok' &&
                          formValues.jenis_observasi !== 'Observasi Kelompok'
                        ) {
                          return null;
                        }
                        const isConditionallyRequired =
                          field.required ||
                          (selectedService.id === 'IZIN_OBSERVASI' &&
                            field.name === 'anggota_kelompok' &&
                            formValues.jenis_observasi === 'Observasi Kelompok');
                        const isLockedSelect =
                          field.type === 'select' &&
                          Boolean(field.locked) &&
                          Boolean((formValues[field.name] || '').trim());

                        return (
                          <div
                            key={field.name}
                            className={field.type === 'textarea' ? 'md:col-span-2' : ''}
                          >
                            <label
                              htmlFor={`field-${field.name}`}
                              className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-stone-800 mb-1.5"
                            >
                              <span>
                                {field.label}{' '}
                                {isConditionallyRequired && (
                                  <span className="text-rose-600">*</span>
                                )}
                              </span>
                              {isLockedSelect && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-amber-950 bg-amber-200/80 border border-amber-300 rounded">
                                  <Lock className="w-3 h-3" aria-hidden="true" />
                                  <span>Dikunci staf</span>
                                </span>
                              )}
                            </label>
                            {field.type === 'textarea' ? (
                              <textarea
                                id={`field-${field.name}`}
                                rows={3}
                                value={formValues[field.name] || ''}
                                onChange={(e) =>
                                  setFormValues((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                placeholder={field.placeholder}
                                className="w-full px-3.5 py-2.5 text-sm bg-white border border-amber-300 rounded-md text-stone-950 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                              />
                            ) : field.type === 'select' ? (
                              <>
                                <select
                                  id={`field-${field.name}`}
                                  disabled={isLockedSelect}
                                  value={formValues[field.name] || ''}
                                  onChange={(e) => {
                                    if (isLockedSelect) return;
                                    setFormValues((prev) => ({
                                      ...prev,
                                      [field.name]: e.target.value,
                                    }));
                                  }}
                                  className={`w-full px-3.5 py-2.5 text-sm border rounded-md focus:outline-none ${
                                    isLockedSelect
                                      ? 'bg-amber-50/80 border-amber-200 text-stone-700 cursor-not-allowed'
                                      : 'bg-white border-amber-300 text-stone-950 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600'
                                  }`}
                                >
                                  <option value="">{field.placeholder}</option>
                                  {formValues[field.name] &&
                                    !field.options?.includes(formValues[field.name]) && (
                                      <option value={formValues[field.name]}>
                                        {formValues[field.name]}
                                      </option>
                                    )}
                                  {field.options?.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                                {isLockedSelect && (
                                  <p className="text-[11px] text-amber-800 mt-1">
                                    Isian ini dikunci oleh staf akademik dan tidak dapat diubah.
                                  </p>
                                )}
                              </>
                            ) : (
                            <input
                              id={`field-${field.name}`}
                              type={field.type}
                              value={formValues[field.name] || ''}
                              onChange={(e) =>
                                setFormValues((prev) => ({
                                  ...prev,
                                  [field.name]: e.target.value,
                                }))
                              }
                              placeholder={field.placeholder}
                              className="w-full px-3.5 py-2.5 text-sm bg-white border border-amber-300 rounded-md text-stone-950 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                            />
                          )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Unggah Dokumen Pendukung (hanya tampil jika layanan membutuhkan dokumen) */}
                  {selectedService.requiredDocuments.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-stone-700 mb-1">
                        {selectedService.id === 'PINDAH_KULIAH'
                          ? '03. Unduh 3 Berkas Persyaratan & Unggah Kembali Setelah Ditandatangani + Distempel'
                          : '03. Unggah Dokumen Pendukung (PDF, JPG, atau PNG · Maks. 5 MB per berkas)'}
                      </h3>
                      <p className="text-xs text-stone-500 mb-4">
                        {selectedService.id === 'PINDAH_KULIAH'
                          ? 'Unduh 3 berkas resmi di bawah ini terlebih dahulu. Jika belum sempat melengkapi tanda tangan & stempel sekarang, Anda dapat menyimpan Langkah 1 terlebih dahulu dan mengunggah 3 berkas tersebut pada Langkah 2 di menu Riwayat Pengajuan.'
                          : 'Berkas akan diperiksa secara digital oleh Staf Administrasi sebelum surat diterbitkan.'}
                      </p>

                      <div className="space-y-3">
                        {selectedService.requiredDocuments.map((docDef) => {
                          const file = slotFiles[docDef.id] || null;
                          return (
                            <div
                              key={docDef.id}
                              className="p-4 border border-amber-200 rounded-md bg-amber-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-stone-900">
                                  {docDef.label}{' '}
                                  {docDef.required ? (
                                    <span className="text-rose-600">*</span>
                                  ) : (
                                    <span className="text-xs font-normal text-stone-500">
                                      (Opsional)
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-stone-500 mt-0.5">{docDef.description}</p>
                                {file && (
                                  <p className="text-xs font-medium text-emerald-700 mt-1.5 truncate">
                                    Berkas dipilih: {file.name} ({formatBytes(file.size)})
                                  </p>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                {docDef.templateUrl && (
                                  <a
                                    href={docDef.templateUrl}
                                    download={docDef.templateFileName || `${docDef.id}.pdf`}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-950 bg-amber-200/90 border border-amber-300 rounded-md hover:bg-amber-300 transition-colors whitespace-nowrap"
                                  >
                                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>Unduh Berkas</span>
                                  </a>
                                )}
                                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 cursor-pointer transition-colors whitespace-nowrap">
                                  <Upload className="w-3.5 h-3.5 text-orange-600" aria-hidden="true" />
                                  <span>{file ? 'Ganti Berkas' : 'Pilih Berkas'}</span>
                                  <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                    className="sr-only"
                                    onChange={(e) => {
                                      const picked = e.target.files?.[0] || null;
                                      setSlotFiles((prev) => ({ ...prev, [docDef.id]: picked }));
                                    }}
                                  />
                                </label>
                                {file && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSlotFiles((prev) => ({ ...prev, [docDef.id]: null }))
                                    }
                                    className="p-2 text-stone-500 hover:text-rose-700"
                                    aria-label={`Hapus ${docDef.label}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {/* Lampiran Tambahan Opsional */}
                        <div className="p-4 border border-dashed border-amber-300 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium text-stone-800">
                              Lampiran Pendukung Tambahan (Opsional)
                            </p>
                            <p className="text-xs text-stone-500 mt-0.5">
                              Unggah berkas pelengkap lain jika diminta oleh instansi tujuan.
                            </p>
                            {extraFiles.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {extraFiles.map((ef, idx) => (
                                  <div
                                    key={`${ef.name}-${idx}`}
                                    className="flex items-center gap-2 text-xs text-stone-700"
                                  >
                                    <span>
                                      • {ef.name} ({formatBytes(ef.size)})
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExtraFiles((prev) => prev.filter((_, i) => i !== idx))
                                      }
                                      className="text-rose-600 hover:underline"
                                    >
                                      Hapus
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 cursor-pointer shrink-0 whitespace-nowrap">
                            <Upload className="w-3.5 h-3.5 text-orange-600" aria-hidden="true" />
                            <span>Tambah Lampiran</span>
                            <input
                              type="file"
                              multiple
                              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                              className="sr-only"
                              onChange={(e) => {
                                const list = Array.from(e.target.files || []);
                                if (list.length > 0) {
                                  setExtraFiles((prev) => [...prev, ...list].slice(0, 3));
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {formError && (
                    <div
                      role="alert"
                      className="p-3.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md"
                    >
                      {formError}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-amber-200">
                    <button
                      type="button"
                      onClick={() => setSelectedService(null)}
                      className="px-4 py-2 text-xs font-semibold text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
                    >
                      Batal
                    </button>
                    {selectedService.id === 'PINDAH_KULIAH' && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => submitNewRequestWithMode('step1_only')}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-amber-950 bg-amber-300 border border-amber-400 rounded-md hover:bg-amber-400 disabled:opacity-60"
                      >
                        {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>Simpan Langkah 1 (Lengkapi &amp; Unggah 3 Berkas Nanti)</span>
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
                    >
                      {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>
                        {selectedService.id === 'PINDAH_KULIAH'
                          ? 'Kirim Formulir & 3 Berkas Lengkap'
                          : 'Kirim Pengajuan Surat'}
                      </span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: RIWAYAT PENGAJUAN */}
          {tab === 'history' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-stone-950">
                    Riwayat & Status Verifikasi Surat
                  </h2>
                  <p className="text-sm text-stone-600 mt-1">
                    Pantau proses verifikasi digital staf administrasi, perbaiki berkas revisi, atau
                    cetak surat resmi yang sudah disetujui.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchMyRequests}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50 self-start sm:self-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-orange-600" />
                  <span>Muat Ulang</span>
                </button>
              </div>

              {/* Strip Ringkas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 bg-white border border-amber-200 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-amber-200">
                <div className="p-4">
                  <p className="text-xs text-stone-500">Total Pengajuan</p>
                  <p className="text-2xl font-bold text-stone-950 mt-1 tabular-nums">
                    {counts.total}
                  </p>
                </div>
                <div className="p-4">
                  <p className="text-xs text-stone-500">Dalam Verifikasi</p>
                  <p className="text-2xl font-bold text-amber-600 mt-1 tabular-nums">
                    {counts.pending}
                  </p>
                </div>
                <div className="p-4">
                  <p className="text-xs text-stone-500">Perlu Revisi</p>
                  <p className="text-2xl font-bold text-orange-700 mt-1 tabular-nums">
                    {counts.revision}
                  </p>
                </div>
                <div className="p-4">
                  <p className="text-xs text-stone-500">Surat Disetujui</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                    {counts.approved}
                  </p>
                </div>
              </div>

              {/* Filter & Pencarian */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-amber-100/70 border border-amber-200 rounded-lg">
                  {(
                    [
                      'ALL',
                      'Menunggu Berkas',
                      'Menunggu Verifikasi',
                      'Perlu Revisi',
                      'Disetujui',
                      'Ditolak',
                    ] as const
                  ).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setHistoryFilter(st)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        historyFilter === st
                          ? 'bg-orange-600 text-white shadow-sm'
                          : 'text-stone-700 hover:text-orange-800'
                      }`}
                    >
                      {st === 'ALL' ? 'Semua' : st}
                    </button>
                  ))}
                </div>

                <div className="relative w-full md:w-64">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Cari kode atau jenis surat..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                  />
                </div>
              </div>

              {/* Daftar Pengajuan */}
              <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
                {loadingRequests ? (
                  <div className="p-8 space-y-3">
                    <div className="h-10 bg-amber-100/60 rounded animate-pulse" />
                    <div className="h-10 bg-amber-100/60 rounded animate-pulse" />
                  </div>
                ) : filteredRequests.length === 0 ? (
                  <div className="p-10 text-center">
                    <FileText className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-stone-900">
                      Belum ada pengajuan surat pada filter ini
                    </p>
                    <p className="text-xs text-stone-500 mt-1 mb-4">
                      Ajukan surat akademik baru dan unggah dokumen pendukung untuk diverifikasi staf.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setTab('services');
                        setSelectedService(null);
                      }}
                      className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700"
                    >
                      Buat Pengajuan Baru
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-amber-200 bg-amber-100/70 text-xs font-semibold text-amber-950">
                          <th className="py-3 px-4">Kode Registrasi</th>
                          <th className="py-3 px-4">Jenis Layanan Surat</th>
                          <th className="py-3 px-4">Tanggal Ajuan</th>
                          <th className="py-3 px-4">Lampiran</th>
                          <th className="py-3 px-4">Status Verifikasi</th>
                          <th className="py-3 px-4 text-right">Tindakan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100 text-sm">
                        {filteredRequests.map((req) => {
                          const srv = getLetterService(req.letter_type, services);
                          return (
                            <tr key={req.id} className="hover:bg-amber-50/60 transition-colors">
                              <td className="py-3 px-4 font-mono text-xs font-medium text-stone-900 whitespace-nowrap">
                                {req.tracking_code}
                              </td>
                              <td className="py-3 px-4">
                                <p className="font-medium text-stone-900 text-xs sm:text-sm">
                                  {srv?.title || req.letter_type}
                                </p>
                                {req.official_number && (
                                  <p className="text-xs font-mono text-stone-500 mt-0.5">
                                    No. {req.official_number}
                                  </p>
                                )}
                              </td>
                              <td className="py-3 px-4 text-xs text-stone-600 tabular-nums whitespace-nowrap">
                                {formatTanggalIndonesia(req.created_at)}
                              </td>
                              <td className="py-3 px-4 text-xs text-stone-600 tabular-nums whitespace-nowrap">
                                {req.documents?.length || 0} berkas
                              </td>
                              <td className="py-3 px-4">
                                <StatusIndicator status={req.status} />
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveDetail(req)}
                                  className="px-2.5 py-1.5 text-xs font-medium text-stone-700 bg-white border border-amber-300 rounded hover:bg-amber-50"
                                >
                                  Rincian
                                </button>
                                {req.letter_type === 'PINDAH_KULIAH' &&
                                (req.status === 'Menunggu Berkas' ||
                                  req.status === 'Perlu Revisi') ? (
                                  <button
                                    type="button"
                                    onClick={() => setActiveDetail(req)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded hover:bg-orange-700"
                                  >
                                    <Upload className="w-3 h-3" />
                                    <span>Unggah 3 Berkas</span>
                                  </button>
                                ) : (
                                  req.status === 'Perlu Revisi' && (
                                    <button
                                      type="button"
                                      onClick={() => startRevision(req)}
                                      className="px-2.5 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded hover:bg-orange-700"
                                    >
                                      Perbaiki Berkas
                                    </button>
                                  )
                                )}
                                {req.status === 'Disetujui' &&
                                  (req.letter_type === 'PINDAH_KULIAH' ? (
                                    req.manual_pdf_name ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => openManualPdfPreview(req)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded hover:bg-orange-700"
                                        >
                                          <Eye className="w-3 h-3" />
                                          <span>Lihat PDF</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDownloadManualPdf(req)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-300 rounded hover:bg-amber-400"
                                        >
                                          <Download className="w-3 h-3" />
                                          <span>Unduh Surat PDF</span>
                                        </button>
                                      </>
                                    ) : (
                                      <span className="text-[11px] text-amber-700 font-medium">
                                        PDF sedang disiapkan
                                      </span>
                                    )
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setAutoDownloadPdf(false);
                                          setOfficialLetterReq(req);
                                        }}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded hover:bg-orange-700"
                                      >
                                        <FileText className="w-3 h-3" />
                                        <span>Lihat Surat</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setAutoDownloadPdf(true);
                                          setOfficialLetterReq(req);
                                        }}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-300 rounded hover:bg-amber-400"
                                      >
                                        <Download className="w-3 h-3" />
                                        <span>Simpan PDF</span>
                                      </button>
                                    </>
                                  ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Panel Rincian Pengajuan Mahasiswa */}
              {activeDetail && (
                <div className="bg-white border border-amber-200 rounded-lg p-6 space-y-5">
                  <div className="flex items-start justify-between gap-4 border-b border-amber-200 pb-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-stone-500">
                        <span className="font-mono font-semibold text-orange-700">
                          {activeDetail.tracking_code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <StatusIndicator status={activeDetail.status} />
                      </div>
                      <h3 className="text-base font-bold text-stone-950 mt-1">
                        {getLetterService(activeDetail.letter_type, services)?.title}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {activeDetail.status === 'Disetujui' &&
                        (activeDetail.letter_type === 'PINDAH_KULIAH' ? (
                          activeDetail.manual_pdf_name && (
                            <>
                              <button
                                type="button"
                                onClick={() => openManualPdfPreview(activeDetail)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded hover:bg-orange-700"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Lihat PDF</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadManualPdf(activeDetail)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-300 rounded hover:bg-amber-400"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Unduh Surat PDF</span>
                              </button>
                            </>
                          )
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setAutoDownloadPdf(false);
                                setOfficialLetterReq(activeDetail);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded hover:bg-orange-700"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Lihat Surat</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAutoDownloadPdf(true);
                                setOfficialLetterReq(activeDetail);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-300 rounded hover:bg-amber-400"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Simpan PDF</span>
                            </button>
                          </>
                        ))}
                      <button
                        type="button"
                        onClick={() => setActiveDetail(null)}
                        className="p-1.5 text-stone-500 hover:text-stone-900"
                        aria-label="Tutup rincian"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {activeDetail.verification_notes && (
                    <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-md">
                      <p className="text-xs font-semibold text-stone-800">
                        Catatan Verifikasi Staf ({activeDetail.verified_by || 'Staf Administrasi'}):
                      </p>
                      <p className="text-sm text-stone-700 mt-1">
                        {activeDetail.verification_notes}
                      </p>
                    </div>
                  )}

                  {/* Panel Alur 3 Langkah Khusus Permohonan Pindah Kuliah */}
                  {activeDetail.letter_type === 'PINDAH_KULIAH' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50/70">
                          <p className="font-bold text-emerald-900">
                            1. Formulir &amp; Unduh 3 Berkas
                          </p>
                          <p className="text-emerald-800 mt-0.5">
                            Formulir permohonan telah tercatat. Pastikan ke-3 berkas sudah
                            ditandatangani &amp; distempel.
                          </p>
                        </div>
                        <div
                          className={`p-3 rounded-md border ${
                            activeDetail.status === 'Menunggu Berkas' ||
                            activeDetail.status === 'Perlu Revisi'
                              ? 'border-orange-300 bg-orange-50'
                              : activeDetail.status === 'Ditolak'
                              ? 'border-rose-200 bg-rose-50'
                              : 'border-emerald-200 bg-emerald-50/70'
                          }`}
                        >
                          <p className="font-bold text-stone-900">
                            2. Unggah Kembali 3 Berkas Lengkap
                          </p>
                          <p className="text-stone-700 mt-0.5">
                            {activeDetail.status === 'Menunggu Berkas'
                              ? 'Menunggu Anda mengunggah 3 berkas yang telah ditandatangani & distempel.'
                              : activeDetail.status === 'Perlu Revisi'
                              ? 'Silakan perbaiki dan unggah ulang berkas yang diminta staf.'
                              : activeDetail.status === 'Menunggu Verifikasi'
                              ? '3 berkas sudah diunggah dan menunggu pemeriksaan staf.'
                              : activeDetail.status === 'Sedang Diproses'
                              ? 'Seluruh berkas disetujui untuk diproses. Staf sedang menyiapkan Surat Pindah (PDF).'
                              : activeDetail.status === 'Disetujui'
                              ? 'Seluruh berkas telah disetujui dan selesai diproses.'
                              : 'Pengajuan ditolak.'}
                          </p>
                        </div>
                        <div
                          className={`p-3 rounded-md border ${
                            activeDetail.status === 'Disetujui' && activeDetail.manual_pdf_name
                              ? 'border-emerald-300 bg-emerald-50'
                              : 'border-amber-200 bg-amber-50/50'
                          }`}
                        >
                          <p className="font-bold text-stone-900">
                            3. Unduh File PDF Surat Pindah
                          </p>
                          <p className="text-stone-700 mt-0.5">
                            {activeDetail.status === 'Disetujui' && activeDetail.manual_pdf_name
                              ? 'File PDF Surat Pindah resmi telah tersedia dan siap diunduh.'
                              : 'Surat Pindah diberikan dalam bentuk file PDF setelah seluruh berkas disetujui staf.'}
                          </p>
                        </div>
                      </div>

                      {(activeDetail.status === 'Menunggu Berkas' ||
                        activeDetail.status === 'Perlu Revisi') && (
                        <form
                          onSubmit={handleSubmitStep2Upload}
                          className="p-5 border border-orange-300 bg-amber-50/60 rounded-lg space-y-4"
                        >
                          <div>
                            <h4 className="text-sm font-bold text-stone-950">
                              Langkah 2: Unduh &amp; Unggah Kembali 3 Berkas Pindah Kuliah
                            </h4>
                            <p className="text-xs text-stone-600 mt-1">
                              Unduh 3 berkas berikut jika belum memiliki salinannya, lengkapi
                              tanda tangan dan stempel, lalu unggah kembali ketiga berkas (PDF,
                              JPG, atau PNG).
                            </p>
                          </div>

                          <div className="space-y-2.5">
                            {(
                              getLetterService('PINDAH_KULIAH', services)?.requiredDocuments || []
                            ).map((docDef) => {
                              const picked = step2SlotFiles[docDef.id] || null;
                              const uploadedExisting = (activeDetail.documents || []).find(
                                (d) => d.doc_type === docDef.label
                              );
                              return (
                                <div
                                  key={docDef.id}
                                  className="p-3.5 bg-white border border-amber-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                >
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-stone-900">
                                      {docDef.label} <span className="text-rose-600">*</span>
                                    </p>
                                    <p className="text-[11px] text-stone-500 mt-0.5">
                                      {docDef.description}
                                    </p>
                                    {picked ? (
                                      <p className="text-xs font-medium text-emerald-700 mt-1 truncate">
                                        Berkas baru dipilih: {picked.name} (
                                        {formatBytes(picked.size)})
                                      </p>
                                    ) : uploadedExisting ? (
                                      <p className="text-xs font-medium text-stone-700 mt-1 truncate">
                                        Sudah terunggah: {uploadedExisting.original_name}
                                      </p>
                                    ) : (
                                      <p className="text-[11px] text-amber-800 mt-1">
                                        Belum diunggah
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    {docDef.templateUrl && (
                                      <a
                                        href={docDef.templateUrl}
                                        download={docDef.templateFileName || `${docDef.id}.pdf`}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-200 border border-amber-300 rounded hover:bg-amber-300"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        <span>Unduh Berkas</span>
                                      </a>
                                    )}
                                    <label className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded hover:bg-amber-50 cursor-pointer">
                                      <Upload className="w-3.5 h-3.5 text-orange-600" />
                                      <span>
                                        {picked || uploadedExisting ? 'Ganti Berkas' : 'Unggah Berkas'}
                                      </span>
                                      <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                        className="sr-only"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0] || null;
                                          setStep2SlotFiles((prev) => ({
                                            ...prev,
                                            [docDef.id]: file,
                                          }));
                                        }}
                                      />
                                    </label>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {activeDetail.status === 'Perlu Revisi' && (
                            <div className="flex justify-start">
                              <button
                                type="button"
                                onClick={() => startRevision(activeDetail)}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 hover:text-orange-900 underline"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Perlu ubah isian data formulir? Edit &amp; Kirim Ulang Formulir</span>
                              </button>
                            </div>
                          )}

                          {step2Error && (
                            <p
                              role="alert"
                              className="text-xs text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-md"
                            >
                              {step2Error}
                            </p>
                          )}

                          <div className="flex justify-end">
                            <button
                              type="submit"
                              disabled={uploadingStep2}
                              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
                            >
                              {uploadingStep2 && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              <Upload className="w-3.5 h-3.5" />
                              <span>Kirim 3 Berkas Lengkap ke Verifikasi Staf</span>
                            </button>
                          </div>
                        </form>
                      )}

                      {activeDetail.status === 'Disetujui' && activeDetail.manual_pdf_name && (
                        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-emerald-950">
                              Langkah 3: Surat Pindah Kuliah (File PDF) Tersedia
                            </p>
                            <p className="text-xs text-emerald-800 mt-0.5 truncate">
                              {activeDetail.manual_pdf_name}
                              {activeDetail.manual_pdf_size
                                ? ` · ${formatBytes(activeDetail.manual_pdf_size)}`
                                : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => openManualPdfPreview(activeDetail)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Lihat PDF</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadManualPdf(activeDetail)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-950 bg-emerald-200 border border-emerald-300 rounded-md hover:bg-emerald-300"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Unduh Surat PDF</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-xs font-semibold text-stone-700 mb-2">
                        Data Formulir yang Dikirim
                      </h4>
                      <dl className="divide-y divide-amber-100 border border-amber-200 rounded-md">
                        {Object.entries(activeDetail.form_data).map(([k, v]) => {
                          const fieldLabel =
                            getLetterService(activeDetail.letter_type, services)?.formFields.find(
                              (f) => f.name === k
                            )?.label || k.replace(/_/g, ' ');
                          return (
                            <div key={k} className="px-3.5 py-2.5 text-xs flex justify-between gap-4">
                              <dt className="text-stone-500">{fieldLabel}</dt>
                              <dd className="text-stone-900 font-medium text-right">{v || '-'}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold text-stone-700 mb-2">
                        Dokumen Pendukung Terunggah
                      </h4>
                      {(activeDetail.documents || []).length === 0 ? (
                        <p className="text-xs text-stone-500">
                          Belum ada berkas dokumen pendukung terunggah.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {(activeDetail.documents || []).map((doc) => (
                            <div
                              key={doc.id}
                              className="flex items-center justify-between gap-3 p-3 border border-amber-200 rounded-md text-xs"
                            >
                              <div className="min-w-0">
                                <p className="font-semibold text-stone-900 truncate">{doc.doc_type}</p>
                                <p className="text-stone-500 truncate mt-0.5">
                                  {doc.original_name} · {formatBytes(doc.size_bytes)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setPreviewDoc(doc)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 rounded shrink-0"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Lihat</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Panel Perbaikan Revisi */}
              {revisingRequest && (
                <form
                  onSubmit={handleSubmitRevision}
                  className="bg-white border border-orange-400 rounded-lg p-6 space-y-5"
                >
                  <div className="flex items-start justify-between gap-4 border-b border-amber-200 pb-4">
                    <div>
                      <p className="text-xs font-semibold text-orange-700">
                        Perbaikan Pengajuan · {revisingRequest.tracking_code}
                      </p>
                      <h3 className="text-base font-bold text-stone-950 mt-0.5">
                        {getLetterService(revisingRequest.letter_type, services)?.title}
                      </h3>
                      {revisingRequest.verification_notes && (
                        <p className="text-xs text-stone-700 mt-1.5">
                          Catatan staf: {revisingRequest.verification_notes}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setRevisingRequest(null)}
                      className="p-1.5 text-stone-500 hover:text-stone-900"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(getLetterService(revisingRequest.letter_type, services)?.formFields || []).map(
                      (field) => {
                        if (
                          revisingRequest.letter_type === 'AKTIF_KULIAH' &&
                          field.name === 'mulai_studi'
                        ) {
                          return null;
                        }
                        if (
                          revisingRequest.letter_type === 'IZIN_OBSERVASI' &&
                          field.name === 'anggota_kelompok' &&
                          revisionFormValues.jenis_observasi !== 'Observasi Kelompok'
                        ) {
                          return null;
                        }
                        const isLockedSelect =
                          field.type === 'select' &&
                          Boolean(field.locked) &&
                          Boolean((revisionFormValues[field.name] || '').trim());

                        return (
                          <div
                            key={field.name}
                            className={field.type === 'textarea' ? 'md:col-span-2' : ''}
                          >
                            <label className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-stone-800 mb-1">
                              <span>
                                {field.label}
                                {(field.required ||
                                  (revisingRequest.letter_type === 'IZIN_OBSERVASI' &&
                                    field.name === 'anggota_kelompok' &&
                                    revisionFormValues.jenis_observasi === 'Observasi Kelompok')) && (
                                  <span className="text-rose-600"> *</span>
                                )}
                              </span>
                              {isLockedSelect && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-amber-950 bg-amber-200/80 border border-amber-300 rounded">
                                  <Lock className="w-3 h-3" aria-hidden="true" />
                                  <span>Dikunci staf</span>
                                </span>
                              )}
                            </label>
                            {field.type === 'textarea' ? (
                              <textarea
                                rows={2}
                                value={revisionFormValues[field.name] || ''}
                                onChange={(e) =>
                                  setRevisionFormValues((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                              />
                            ) : field.type === 'select' ? (
                              <>
                                <select
                                  disabled={isLockedSelect}
                                  value={revisionFormValues[field.name] || ''}
                                  onChange={(e) => {
                                    if (isLockedSelect) return;
                                    setRevisionFormValues((prev) => ({
                                      ...prev,
                                      [field.name]: e.target.value,
                                    }));
                                  }}
                                  className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none ${
                                    isLockedSelect
                                      ? 'bg-amber-50/80 border-amber-200 text-stone-700 cursor-not-allowed'
                                      : 'bg-white border-amber-300 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600'
                                  }`}
                                >
                                  <option value="">{field.placeholder}</option>
                                  {revisionFormValues[field.name] &&
                                    !field.options?.includes(revisionFormValues[field.name]) && (
                                      <option value={revisionFormValues[field.name]}>
                                        {revisionFormValues[field.name]}
                                      </option>
                                    )}
                                  {field.options?.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                                {isLockedSelect && (
                                  <p className="text-[11px] text-amber-800 mt-1">
                                    Isian ini dikunci oleh staf akademik dan tidak dapat diubah.
                                  </p>
                                )}
                              </>
                            ) : (
                              <input
                                type={field.type === 'date' ? 'date' : 'text'}
                                value={revisionFormValues[field.name] || ''}
                                onChange={(e) =>
                                  setRevisionFormValues((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                              />
                            )}
                          </div>
                        );
                      }
                    )}
                  </div>

                  {(getLetterService(revisingRequest.letter_type, services)?.requiredDocuments
                    ?.length || 0) > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-stone-800 mb-1.5">
                        Unggah Dokumen Tambahan / Perbaikan (Opsional jika hanya memperbaiki teks)
                      </label>
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => setRevisionFiles(Array.from(e.target.files || []))}
                        className="block w-full text-xs text-stone-600 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-amber-300 file:text-xs file:font-semibold file:bg-amber-50 file:text-amber-950 hover:file:bg-amber-100"
                      />
                    </div>
                  )}

                  {revisionError && (
                    <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded">
                      {revisionError}
                    </p>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setRevisingRequest(null)}
                      className="px-4 py-2 text-xs font-semibold text-stone-700 border border-amber-300 rounded-md hover:bg-amber-50"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      disabled={submittingRevision}
                      className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
                    >
                      {submittingRevision ? 'Mengirim...' : 'Kirim Ulang Pengajuan'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </main>
      </div>

      <DocumentViewerModal
        document={previewDoc}
        customSource={manualPdfPreview}
        token={token}
        onClose={() => {
          setPreviewDoc(null);
          setManualPdfPreview(null);
        }}
      />

      <OfficialLetterModal
        request={officialLetterReq}
        services={services}
        templateSettings={templateSettings}
        isStaff={false}
        autoDownloadPdf={autoDownloadPdf}
        onAutoDownloadDone={() => setAutoDownloadPdf(false)}
        onClose={() => {
          setOfficialLetterReq(null);
          setAutoDownloadPdf(false);
        }}
      />

      {/* Modal Lengkapi Biodata Mahasiswa */}
      {showBiodataModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Lengkapi Biodata Mahasiswa"
        >
          <form
            onSubmit={handleSaveBiodata}
            className="w-full max-w-xl bg-white border border-amber-200 rounded-lg overflow-hidden shadow-xl my-auto"
          >
            <div className="px-5 py-4 border-b border-amber-200 flex items-center justify-between bg-amber-50/70">
              <div>
                <h3 className="text-sm font-bold text-stone-950">
                  Lengkapi Biodata Mahasiswa
                </h3>
                <p className="text-[11px] text-stone-600 mt-0.5">
                  {student.nama} · NPM {student.nim}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBiodataModal(false)}
                className="p-1 text-stone-500 hover:text-stone-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  NIK (Nomor Induk Kependudukan){' '}
                  {!biodataDraft.nik.trim() && (
                    <span className="font-normal text-amber-700">(Kosong)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={biodataDraft.nik}
                  onChange={(e) => setBiodataDraft((p) => ({ ...p, nik: e.target.value }))}
                  placeholder="16 digit NIK sesuai KTP"
                  className={`w-full px-3 py-2 font-mono border rounded-md ${
                    !biodataDraft.nik.trim()
                      ? 'border-amber-400 bg-amber-50/40'
                      : 'border-amber-300'
                  }`}
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Jenis Kelamin{' '}
                  {!biodataDraft.jenis_kelamin.trim() && (
                    <span className="font-normal text-amber-700">(Kosong)</span>
                  )}
                </label>
                <select
                  value={biodataDraft.jenis_kelamin}
                  onChange={(e) =>
                    setBiodataDraft((p) => ({ ...p, jenis_kelamin: e.target.value }))
                  }
                  className={`w-full px-3 py-2 border rounded-md ${
                    !biodataDraft.jenis_kelamin.trim()
                      ? 'border-amber-400 bg-amber-50/40'
                      : 'border-amber-300'
                  }`}
                >
                  <option value="">Pilih jenis kelamin</option>
                  <option value="Laki-laki">Laki-laki</option>
                  <option value="Perempuan">Perempuan</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Tempat Lahir{' '}
                  {!biodataDraft.tempat_lahir.trim() && (
                    <span className="font-normal text-amber-700">(Kosong)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={biodataDraft.tempat_lahir}
                  onChange={(e) =>
                    setBiodataDraft((p) => ({ ...p, tempat_lahir: e.target.value }))
                  }
                  placeholder="Contoh: TARAKAN"
                  className={`w-full px-3 py-2 border rounded-md ${
                    !biodataDraft.tempat_lahir.trim()
                      ? 'border-amber-400 bg-amber-50/40'
                      : 'border-amber-300'
                  }`}
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Tanggal Lahir{' '}
                  {!biodataDraft.tanggal_lahir.trim() && (
                    <span className="font-normal text-amber-700">(Kosong)</span>
                  )}
                </label>
                <input
                  type="date"
                  value={biodataDraft.tanggal_lahir}
                  onChange={(e) =>
                    setBiodataDraft((p) => ({ ...p, tanggal_lahir: e.target.value }))
                  }
                  className={`w-full px-3 py-2 border rounded-md ${
                    !biodataDraft.tanggal_lahir.trim()
                      ? 'border-amber-400 bg-amber-50/40'
                      : 'border-amber-300'
                  }`}
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Email{' '}
                  {!biodataDraft.email.trim() && (
                    <span className="font-normal text-amber-700">(Kosong)</span>
                  )}
                </label>
                <input
                  type="email"
                  value={biodataDraft.email}
                  onChange={(e) => setBiodataDraft((p) => ({ ...p, email: e.target.value }))}
                  placeholder="email@unikaltar.ac.id"
                  className={`w-full px-3 py-2 border rounded-md ${
                    !biodataDraft.email.trim()
                      ? 'border-amber-400 bg-amber-50/40'
                      : 'border-amber-300'
                  }`}
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  No. HP / WhatsApp{' '}
                  {!biodataDraft.no_hp.trim() && (
                    <span className="font-normal text-amber-700">(Kosong)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={biodataDraft.no_hp}
                  onChange={(e) => setBiodataDraft((p) => ({ ...p, no_hp: e.target.value }))}
                  placeholder="08xxxxxxxxxx"
                  className={`w-full px-3 py-2 font-mono border rounded-md ${
                    !biodataDraft.no_hp.trim()
                      ? 'border-amber-400 bg-amber-50/40'
                      : 'border-amber-300'
                  }`}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-stone-800 mb-1">
                  Alamat Lengkap{' '}
                  {!biodataDraft.alamat.trim() && (
                    <span className="font-normal text-amber-700">(Kosong)</span>
                  )}
                </label>
                <textarea
                  rows={2}
                  value={biodataDraft.alamat}
                  onChange={(e) => setBiodataDraft((p) => ({ ...p, alamat: e.target.value }))}
                  placeholder="Jalan, RT/RW, Kecamatan, Kabupaten/Kota"
                  className={`w-full px-3 py-2 border rounded-md ${
                    !biodataDraft.alamat.trim()
                      ? 'border-amber-400 bg-amber-50/40'
                      : 'border-amber-300'
                  }`}
                />
              </div>

              {biodataError && (
                <p className="sm:col-span-2 text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded">
                  {biodataError}
                </p>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-amber-200 bg-amber-50/70 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBiodataModal(false)}
                className="px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingBiodata}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
              >
                {savingBiodata ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Simpan Biodata</span>
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Navigasi Bawah Khusus Mobile / Android */}
      <nav
        aria-label="Navigasi Cepat Android Mahasiswa"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-amber-200 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] grid grid-cols-3 gap-1 shadow-lg"
      >
        <button
          type="button"
          onClick={() => {
            setTab('services');
            setSelectedService(null);
            setRevisingRequest(null);
          }}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
            tab === 'services' ? 'text-orange-700 bg-orange-50' : 'text-stone-600'
          }`}
        >
          <FilePlus2 className="w-4 h-4" aria-hidden="true" />
          <span>Ajukan Surat</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setTab('history');
            setSelectedService(null);
          }}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
            tab === 'history' ? 'text-orange-700 bg-orange-50' : 'text-stone-600'
          }`}
        >
          <History className="w-4 h-4" aria-hidden="true" />
          <span>Riwayat ({counts.total})</span>
        </button>

        <button
          type="button"
          onClick={openBiodataModal}
          className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md text-[11px] font-semibold text-stone-600 active:bg-amber-50"
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
          <span>Biodata</span>
        </button>
      </nav>
    </div>
  );
}
