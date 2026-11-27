import {
  AlertTriangle,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  HardDrive,
  Inbox,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Menu,
  PenTool,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Stamp,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  apiRequest,
  apiUpload,
  fetchProtectedBlob,
  formatBytes,
  formatTanggalIndonesia,
} from '../lib/api';
import { processSignatureImage } from '../lib/signature';
import {
  DEFAULT_DEAN_SIGNATURE_URL,
  DEFAULT_DEAN_STAMP_URL,
  DEFAULT_LETTER_SETTINGS,
  DEFAULT_UNIVERSITY_LOGO_URL,
  LETTER_SERVICES,
  getLetterService,
  getMissingStudentFields,
  getRomanMonth,
  type BackupSummary,
  type FormFieldDef,
  type LetterRequest,
  type LetterServiceDefinition,
  type LetterTemplateSettings,
  type LetterTypeId,
  type RequestStatus,
  type StaffAccount,
  type StudentCompletenessStats,
  type StudentRecord,
  type UploadedDocument,
  type VerificationChecklistItem,
} from '../shared/types';
import { DocumentViewerModal, type CustomDocumentSource } from './DocumentViewerModal';
import { OfficialLetterModal } from './OfficialLetterModal';
import { PWAInstallButton } from './PWAInstallButton';
import { StatusIndicator } from './StatusIndicator';

interface StaffPortalProps {
  token: string;
  staffName: string;
  onLogout: () => void;
}

type StaffTab = 'requests' | 'students' | 'forms' | 'backup' | 'staff';
type StudentSortBy = 'default' | 'nim' | 'status_akademik' | 'angkatan' | 'prodi';

interface RequestStats {
  totalRequests: number;
  pendingRequests: number;
  approvedRequests: number;
  totalStudents: number;
}

interface ImportLog {
  id: string;
  filename: string;
  total_rows: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  imported_by: string;
  created_at: string;
}

interface ImportResultSummary {
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  deletedOld?: number;
  mode?: 'upsert' | 'replace' | 'fill_empty';
  errors: string[];
}

function normalizeServiceDef(
  srv?: Partial<LetterServiceDefinition> | null
): LetterServiceDefinition {
  const base = LETTER_SERVICES.find((s) => s.id === srv?.id) || LETTER_SERVICES[0];
  return {
    ...base,
    ...(srv || {}),
    formFields: Array.isArray(srv?.formFields) ? srv.formFields : base.formFields,
    requiredDocuments: Array.isArray(srv?.requiredDocuments)
      ? srv.requiredDocuments
      : base.requiredDocuments,
    defaultChecklist: Array.isArray(srv?.defaultChecklist)
      ? srv.defaultChecklist
      : base.defaultChecklist,
  };
}

export function StaffPortal({ token, staffName, onLogout }: StaffPortalProps) {
  const [tab, setTab] = useState<StaffTab>('requests');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Requests queue state
  const [requests, setRequests] = useState<LetterRequest[]>([]);
  const [stats, setStats] = useState<RequestStats>({
    totalRequests: 0,
    pendingRequests: 0,
    approvedRequests: 0,
    totalStudents: 0,
  });
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [letterTypeFilter, setLetterTypeFilter] = useState<string>('ALL');
  const [reqSearch, setReqSearch] = useState('');

  // Selected request for digital verification
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<VerificationChecklistItem[]>([]);
  const [verificationNotes, setVerificationNotes] = useState('');
  const [officialNumber, setOfficialNumber] = useState('');
  const [nextAutoOfficialNumber, setNextAutoOfficialNumber] = useState('');
  const [signatoryName, setSignatoryName] = useState('');
  const [signatoryNidn, setSignatoryNidn] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('');
  const [signatoryNik, setSignatoryNik] = useState('');
  const [savingVerify, setSavingVerify] = useState(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Staff Edit Formulir state
  const [editingForm, setEditingForm] = useState(false);
  const [editFormValues, setEditFormValues] = useState<Record<string, string>>({});
  const [savingFormEdit, setSavingFormEdit] = useState(false);
  const [editFormError, setEditFormError] = useState<string | null>(null);

  // Students & Excel state
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [prodiList, setProdiList] = useState<string[]>([]);
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentProdiFilter, setStudentProdiFilter] = useState('ALL');
  const [completenessFilter, setCompletenessFilter] = useState<string>('ALL');
  const [studentSortBy, setStudentSortBy] = useState<StudentSortBy>('default');
  const [studentSortDir, setStudentSortDir] = useState<'asc' | 'desc'>('asc');
  const [completenessStats, setCompletenessStats] = useState<StudentCompletenessStats | null>(null);
  const [studentPage, setStudentPage] = useState(1);
  const [importMode, setImportMode] = useState<'upsert' | 'replace' | 'fill_empty'>('upsert');
  const [importingExcel, setImportingExcel] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportResultSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDeleteNim, setConfirmDeleteNim] = useState<string | null>(null);

  // Add / Edit / Complete manual student modal
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [editingExistingStudent, setEditingExistingStudent] = useState(false);
  const [newStudent, setNewStudent] = useState({
    nim: '',
    nik: '',
    nama: '',
    tempat_lahir: '',
    tanggal_lahir: '',
    jenis_kelamin: 'Perempuan',
    jenjang: 'SARJANA (S1)',
    prodi: 'MANAJEMEN',
    fakultas: 'Fakultas Ekonomi',
    angkatan: '2025',
    semester: '3',
    ipk: '3.50',
    email: '',
    no_hp: '',
    alamat: '',
    status_akademik: 'Aktif',
  });
  const [savingStudent, setSavingStudent] = useState(false);
  const [addStudentError, setAddStudentError] = useState<string | null>(null);

  // Dynamic Service Definitions & Official Template Settings (Dekan, NIDN, NIK, Kop Surat)
  const [services, setServices] = useState<LetterServiceDefinition[]>(LETTER_SERVICES);
  const [templateSettings, setTemplateSettings] = useState<LetterTemplateSettings>(
    DEFAULT_LETTER_SETTINGS
  );
  const [settingsDraft, setSettingsDraft] = useState<LetterTemplateSettings>(
    DEFAULT_LETTER_SETTINGS
  );
  const [applyToExistingLetters, setApplyToExistingLetters] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState<string>(DEFAULT_DEAN_SIGNATURE_URL);
  const staffSigInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const [stampPreviewUrl, setStampPreviewUrl] = useState<string>(DEFAULT_DEAN_STAMP_URL);
  const staffStampInputRef = useRef<HTMLInputElement | null>(null);
  const [settingsFeedback, setSettingsFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [activeServiceEditId, setActiveServiceEditId] = useState<LetterTypeId>('AKTIF_KULIAH');
  const [serviceDraft, setServiceDraft] = useState<LetterServiceDefinition>(() =>
    JSON.parse(JSON.stringify(LETTER_SERVICES[0]))
  );
  const [savingServiceForm, setSavingServiceForm] = useState(false);
  const [confirmResetService, setConfirmResetService] = useState(false);
  const [serviceFeedback, setServiceFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Backup & Restore state
  const [currentBackupSummary, setCurrentBackupSummary] = useState<BackupSummary | null>(null);
  const [loadingBackupSummary, setLoadingBackupSummary] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [inspectingBackup, setInspectingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const [inspectedBackup, setInspectedBackup] = useState<BackupSummary | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  // Staff Accounts Management state
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>([]);
  const [loadingStaffAccounts, setLoadingStaffAccounts] = useState(false);
  const [currentStaffId, setCurrentStaffId] = useState('');
  const [envPasscodeActive, setEnvPasscodeActive] = useState(false);
  const [newStaffFullName, setNewStaffFullName] = useState('');
  const [newStaffUsername, setNewStaffUsername] = useState('');
  const [newStaffRoleTitle, setNewStaffRoleTitle] = useState('Staf Administrasi Akademik');
  const [newStaffPasscode, setNewStaffPasscode] = useState('');
  const [newStaffPasscodeConfirm, setNewStaffPasscodeConfirm] = useState('');
  const [showNewStaffPasscode, setShowNewStaffPasscode] = useState(false);
  const [savingNewStaff, setSavingNewStaff] = useState(false);
  const [staffAccountFeedback, setStaffAccountFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [confirmDeleteStaffId, setConfirmDeleteStaffId] = useState<string | null>(null);
  const [togglingStaffId, setTogglingStaffId] = useState<string | null>(null);
  const [deletingStaffId, setDeletingStaffId] = useState<string | null>(null);

  const [editingStaffAccount, setEditingStaffAccount] = useState<StaffAccount | null>(null);
  const [editStaffFullName, setEditStaffFullName] = useState('');
  const [editStaffRoleTitle, setEditStaffRoleTitle] = useState('');
  const [editStaffNewPasscode, setEditStaffNewPasscode] = useState('');
  const [editStaffNewPasscodeConfirm, setEditStaffNewPasscodeConfirm] = useState('');
  const [showEditStaffPasscode, setShowEditStaffPasscode] = useState(false);
  const [savingEditStaff, setSavingEditStaff] = useState(false);
  const [editStaffError, setEditStaffError] = useState<string | null>(null);

  // Modals
  const [previewDoc, setPreviewDoc] = useState<UploadedDocument | null>(null);
  const [manualPdfPreview, setManualPdfPreview] = useState<CustomDocumentSource | null>(null);
  const [uploadingManualPdf, setUploadingManualPdf] = useState(false);
  const manualPdfInputRef = useRef<HTMLInputElement | null>(null);
  const [officialLetterReq, setOfficialLetterReq] = useState<LetterRequest | null>(null);
  const [autoDownloadPdf, setAutoDownloadPdf] = useState(false);

  const loadFormConfig = useCallback(async () => {
    try {
      const res = await apiRequest<{
        services: LetterServiceDefinition[];
        templateSettings: LetterTemplateSettings;
      }>('/api/services');
      if (Array.isArray(res.services) && res.services.length > 0) {
        setServices(res.services.map((s) => normalizeServiceDef(s)));
      }
      if (res.templateSettings) {
        setTemplateSettings(res.templateSettings);
        setSettingsDraft(res.templateSettings);
      }
    } catch {
      // fallback to defaults
    }
  }, []);

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (letterTypeFilter !== 'ALL') params.set('letter_type', letterTypeFilter);
      if (reqSearch.trim()) params.set('q', reqSearch.trim());

      const res = await apiRequest<{
        requests: LetterRequest[];
        stats: RequestStats;
        nextOfficialNumber?: string;
      }>(`/api/requests?${params.toString()}`, { token });
      const nextReqs = Array.isArray(res.requests) ? res.requests : [];
      setRequests(nextReqs);
      if (res.stats) setStats(res.stats);
      if (res.nextOfficialNumber) {
        setNextAutoOfficialNumber(res.nextOfficialNumber);
      }
      setSelectedId((prev) => {
        if (prev && nextReqs.some((r) => r.id === prev)) return prev;
        return nextReqs[0]?.id || null;
      });
    } catch {
      // ignore
    } finally {
      setLoadingRequests(false);
    }
  }, [token, statusFilter, letterTypeFilter, reqSearch]);

  const loadStudents = useCallback(async () => {
    setLoadingStudents(true);
    try {
      const params = new URLSearchParams();
      if (studentSearch.trim()) params.set('q', studentSearch.trim());
      if (studentProdiFilter !== 'ALL') params.set('prodi', studentProdiFilter);
      if (completenessFilter !== 'ALL') params.set('completeness', completenessFilter);
      if (studentSortBy !== 'default') {
        params.set('sortBy', studentSortBy);
        params.set('sortDir', studentSortDir);
      }

      const res = await apiRequest<{
        students: StudentRecord[];
        prodiList: string[];
        importLogs: ImportLog[];
        completenessStats?: StudentCompletenessStats;
      }>(`/api/students?${params.toString()}`, { token });
      setStudents(Array.isArray(res.students) ? res.students : []);
      setProdiList(Array.isArray(res.prodiList) ? res.prodiList : []);
      setImportLogs(Array.isArray(res.importLogs) ? res.importLogs : []);
      if (res.completenessStats) {
        setCompletenessStats(res.completenessStats);
      }
      setStudentPage(1);
    } catch {
      // ignore
    } finally {
      setLoadingStudents(false);
    }
  }, [token, studentSearch, studentProdiFilter, completenessFilter, studentSortBy, studentSortDir]);

  const loadBackupSummary = useCallback(async () => {
    setLoadingBackupSummary(true);
    try {
      const res = await apiRequest<{ summary: BackupSummary }>('/api/staff/backup/summary', {
        token,
      });
      setCurrentBackupSummary(res.summary);
    } catch {
      // ignore
    } finally {
      setLoadingBackupSummary(false);
    }
  }, [token]);

  const loadStaffAccounts = useCallback(async () => {
    setLoadingStaffAccounts(true);
    try {
      const res = await apiRequest<{
        accounts: StaffAccount[];
        currentStaffId: string;
        currentStaffName: string;
        envPasscodeActive: boolean;
      }>('/api/staff/accounts', { token });
      setStaffAccounts(res.accounts || []);
      setCurrentStaffId(res.currentStaffId || '');
      setEnvPasscodeActive(Boolean(res.envPasscodeActive));
    } catch {
      // ignore
    } finally {
      setLoadingStaffAccounts(false);
    }
  }, [token]);

  useEffect(() => {
    loadFormConfig();
  }, [loadFormConfig]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    loadStaffAccounts();
  }, [loadStaffAccounts]);

  useEffect(() => {
    if (tab === 'students') {
      loadStudents();
    } else if (tab === 'backup') {
      loadBackupSummary();
    } else if (tab === 'staff') {
      loadStaffAccounts();
    }
  }, [tab, loadStudents, loadBackupSummary, loadStaffAccounts]);

  useEffect(() => {
    const target = services.find((s) => s.id === activeServiceEditId) || services[0];
    if (target) {
      setServiceDraft(normalizeServiceDef(JSON.parse(JSON.stringify(target))));
      setConfirmResetService(false);
    }
  }, [activeServiceEditId, services]);

  const selectedRequest = requests.find((r) => r.id === selectedId) || null;

  useEffect(() => {
    if (!selectedRequest) return;
    setChecklist(selectedRequest.checklist || []);
    setVerificationNotes(selectedRequest.verification_notes || '');
    setOfficialNumber(selectedRequest.official_number || nextAutoOfficialNumber || '');
    setSignatoryName(selectedRequest.signatory_name || templateSettings.signatory_name);
    setSignatoryNidn(selectedRequest.signatory_nidn || templateSettings.signatory_nidn);
    setSignatoryTitle(selectedRequest.signatory_title || templateSettings.signatory_title);
    setSignatoryNik(selectedRequest.signatory_nik || templateSettings.signatory_nik);
    setEditingForm(false);
    setEditFormValues({ ...(selectedRequest.form_data || {}) });
    setEditFormError(null);
    setVerifyFeedback(null);
  }, [
    selectedRequest?.id,
    selectedRequest?.signatory_name,
    selectedRequest?.signatory_nidn,
    selectedRequest?.signatory_title,
    selectedRequest?.signatory_nik,
    templateSettings,
  ]);

  useEffect(() => {
    if (selectedRequest && !selectedRequest.official_number && nextAutoOfficialNumber) {
      setOfficialNumber((prev) => (prev ? prev : nextAutoOfficialNumber));
    }
  }, [selectedRequest?.id, selectedRequest?.official_number, nextAutoOfficialNumber]);

  useEffect(() => {
    let cancelled = false;
    const raw = settingsDraft.aktif_kuliah_signature_url || DEFAULT_DEAN_SIGNATURE_URL;
    processSignatureImage(raw, true).then((cleaned) => {
      if (!cancelled) setSignaturePreviewUrl(cleaned);
    });
    return () => {
      cancelled = true;
    };
  }, [settingsDraft.aktif_kuliah_signature_url]);

  useEffect(() => {
    let cancelled = false;
    const raw = settingsDraft.aktif_kuliah_stamp_url || DEFAULT_DEAN_STAMP_URL;
    processSignatureImage(raw, true).then((cleaned) => {
      if (!cancelled) setStampPreviewUrl(cleaned);
    });
    return () => {
      cancelled = true;
    };
  }, [settingsDraft.aktif_kuliah_stamp_url]);

  async function handleUploadStaffSignature(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setSettingsFeedback(null);
    setUploadingSignature(true);
    try {
      const fd = new FormData();
      fd.append('signature', file);
      const res = await apiUpload<{ url: string; templateSettings: LetterTemplateSettings }>(
        '/api/staff/signature',
        fd,
        token
      );
      setTemplateSettings(res.templateSettings);
      setSettingsDraft(res.templateSettings);
      setSettingsFeedback({
        type: 'ok',
        text: 'File tanda tangan Dekan berhasil diunggah dan disiapkan untuk cetak PDF Surat Aktif Kuliah.',
      });
    } catch (err) {
      setSettingsFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengunggah file tanda tangan.',
      });
    } finally {
      setUploadingSignature(false);
    }
  }

  async function handleUploadStaffStamp(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setSettingsFeedback(null);
    setUploadingStamp(true);
    try {
      const fd = new FormData();
      fd.append('stamp', file);
      const res = await apiUpload<{ url: string; templateSettings: LetterTemplateSettings }>(
        '/api/staff/stamp',
        fd,
        token
      );
      setTemplateSettings(res.templateSettings);
      setSettingsDraft(res.templateSettings);
      setSettingsFeedback({
        type: 'ok',
        text: 'File stempel Dekan berhasil diunggah dan disiapkan untuk cetak PDF Surat Aktif Kuliah.',
      });
    } catch (err) {
      setSettingsFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengunggah file stempel.',
      });
    } finally {
      setUploadingStamp(false);
    }
  }

  async function handleSaveTemplateSettings(e: FormEvent) {
    e.preventDefault();
    setSettingsFeedback(null);
    setSavingSettings(true);
    try {
      const res = await apiRequest<{ templateSettings: LetterTemplateSettings }>(
        '/api/staff/template-settings',
        {
          method: 'PUT',
          token,
          body: {
            ...settingsDraft,
            applyToExisting: applyToExistingLetters,
          },
        }
      );
      setTemplateSettings(res.templateSettings);
      setSettingsDraft(res.templateSettings);
      await loadRequests();
      setSettingsFeedback({
        type: 'ok',
        text: applyToExistingLetters
          ? 'Data Dekan (Nama, NIDN, NIK) & Kop Surat berhasil disimpan dan diterapkan ke surat yang ada.'
          : 'Data Dekan (Nama, NIDN, NIK) & Kop Surat berhasil disimpan untuk pengajuan baru dan yang sedang diproses.',
      });
    } catch (err) {
      setSettingsFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan pejabat surat.',
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveServiceForm(e: FormEvent) {
    e.preventDefault();
    setServiceFeedback(null);
    setSavingServiceForm(true);
    try {
      const res = await apiRequest<{
        services: LetterServiceDefinition[];
        service: LetterServiceDefinition;
      }>(`/api/staff/services/${serviceDraft.id}`, {
        method: 'PUT',
        token,
        body: serviceDraft,
      });
      if (Array.isArray(res.services) && res.services.length > 0) {
        setServices(res.services.map((s) => normalizeServiceDef(s)));
      }
      if (res.service) {
        setServiceDraft(normalizeServiceDef(JSON.parse(JSON.stringify(res.service))));
      }
      setServiceFeedback({
        type: 'ok',
        text: `Formulir "${res.service?.title || serviceDraft.title}" berhasil diperbarui dan langsung aktif untuk mahasiswa.`,
      });
    } catch (err) {
      setServiceFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menyimpan formulir layanan surat.',
      });
    } finally {
      setSavingServiceForm(false);
    }
  }

  async function handleResetServiceForm() {
    setServiceFeedback(null);
    setSavingServiceForm(true);
    try {
      const res = await apiRequest<{
        services: LetterServiceDefinition[];
        service: LetterServiceDefinition;
      }>(`/api/staff/services/${serviceDraft.id}/reset`, {
        method: 'POST',
        token,
      });
      if (Array.isArray(res.services) && res.services.length > 0) {
        setServices(res.services.map((s) => normalizeServiceDef(s)));
      }
      if (res.service) {
        setServiceDraft(normalizeServiceDef(JSON.parse(JSON.stringify(res.service))));
      }
      setConfirmResetService(false);
      setServiceFeedback({
        type: 'ok',
        text: `Formulir "${res.service?.title || serviceDraft.title}" dikembalikan ke pengaturan bawaan.`,
      });
    } catch (err) {
      setServiceFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mereset formulir layanan.',
      });
    } finally {
      setSavingServiceForm(false);
    }
  }

  async function handleSaveFormEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedRequest) return;
    setEditFormError(null);
    setSavingFormEdit(true);
    try {
      const res = await apiRequest<{ request: LetterRequest }>(
        `/api/requests/${selectedRequest.id}/form`,
        {
          method: 'PATCH',
          token,
          body: { form_data: editFormValues },
        }
      );
      setRequests((prev) => prev.map((r) => (r.id === res.request.id ? res.request : r)));
      setEditingForm(false);
      setVerifyFeedback({
        type: 'ok',
        text: 'Perubahan data formulir berhasil disimpan.',
      });
    } catch (err) {
      setEditFormError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan formulir.');
    } finally {
      setSavingFormEdit(false);
    }
  }

  async function handleVerifyDecision(nextStatus: RequestStatus) {
    if (!selectedRequest) return;
    setVerifyFeedback(null);

    if ((nextStatus === 'Perlu Revisi' || nextStatus === 'Ditolak') && !verificationNotes.trim()) {
      setVerifyFeedback({
        type: 'err',
        text: 'Tuliskan catatan verifikasi sebagai alasan revisi atau penolakan untuk mahasiswa.',
      });
      return;
    }

    setSavingVerify(true);
    try {
      const res = await apiRequest<{ request: LetterRequest }>(
        `/api/requests/${selectedRequest.id}/verify`,
        {
          method: 'PATCH',
          token,
          body: {
            status: nextStatus,
            verification_notes: verificationNotes,
            official_number:
              nextStatus === 'Disetujui'
                ? officialNumber
                : selectedRequest.official_number || '',
            signatory_name: signatoryName,
            signatory_nidn: signatoryNidn,
            signatory_title: signatoryTitle,
            signatory_nik: signatoryNik,
            checklist,
          },
        }
      );

      setRequests((prev) => prev.map((r) => (r.id === res.request.id ? res.request : r)));
      setOfficialNumber(res.request.official_number);
      setVerifyFeedback({
        type: 'ok',
        text:
          nextStatus === 'Disetujui'
            ? `Pengajuan disetujui dengan Nomor Surat ${res.request.official_number}.`
            : `Status pengajuan diperbarui menjadi "${nextStatus}".`,
      });
      loadRequests();
    } catch (err) {
      setVerifyFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menyimpan keputusan verifikasi.',
      });
    } finally {
      setSavingVerify(false);
    }
  }

  function openManualPdfPreview(req: LetterRequest) {
    setManualPdfPreview({
      url: `/api/requests/${req.id}/manual-letter-pdf`,
      title: `Surat Pindah Kuliah (PDF Manual) · ${req.tracking_code}`,
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
      setVerifyFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengunduh file PDF Surat Pindah.',
      });
    }
  }

  async function handleUploadManualPdf(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedRequest) return;

    setVerifyFeedback(null);
    setUploadingManualPdf(true);
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      const res = await apiUpload<{ request: LetterRequest }>(
        `/api/requests/${selectedRequest.id}/manual-letter-pdf`,
        fd,
        token
      );
      setRequests((prev) => prev.map((r) => (r.id === res.request.id ? res.request : r)));
      setVerifyFeedback({
        type: 'ok',
        text: `File PDF Surat Pindah "${res.request.manual_pdf_name}" berhasil diunggah. Klik "Setujui & Terbitkan Surat" agar mahasiswa dapat mengunduhnya.`,
      });
    } catch (err) {
      setVerifyFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengunggah file PDF Surat Pindah manual.',
      });
    } finally {
      setUploadingManualPdf(false);
    }
  }

  async function handleExcelFile(file: File | null) {
    if (!file) return;
    setImportError(null);
    setImportSummary(null);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', importMode);

    setImportingExcel(true);
    try {
      const res = await apiUpload<ImportResultSummary>(
        '/api/students/import-excel',
        fd,
        token
      );
      setImportSummary(res);
      await loadStudents();
      await loadRequests();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Gagal mengimpor file Excel.');
    } finally {
      setImportingExcel(false);
    }
  }

  async function handleDownloadTemplate() {
    try {
      const blob = await fetchProtectedBlob('/api/students/template-excel', token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Template_Data_Mahasiswa.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Gagal mengunduh template Excel.');
    }
  }

  async function handleDownloadIncompleteExcel() {
    try {
      const blob = await fetchProtectedBlob('/api/students/incomplete-excel', token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Data_Mahasiswa_Belum_Lengkap.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Gagal mengunduh file data mahasiswa belum lengkap.'
      );
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0] || null;
    handleExcelFile(dropped);
  }

  function openEditStudentModal(st: StudentRecord) {
    setEditingExistingStudent(true);
    setNewStudent({
      nim: st.nim,
      nik: st.nik || '',
      nama: st.nama,
      tempat_lahir: st.tempat_lahir || '',
      tanggal_lahir: st.tanggal_lahir || '',
      jenis_kelamin: st.jenis_kelamin || '',
      jenjang: st.jenjang || 'SARJANA (S1)',
      prodi: st.prodi,
      fakultas: st.fakultas,
      angkatan: st.angkatan || '2025',
      semester: String(st.semester || 1),
      ipk: st.ipk || '0.00',
      email: st.email || '',
      no_hp: st.no_hp || '',
      alamat: st.alamat || '',
      status_akademik: st.status_akademik || 'Aktif',
    });
    setAddStudentError(null);
    setShowAddStudent(true);
  }

  async function saveStudentRecord(advanceNext: boolean) {
    setAddStudentError(null);
    setSavingStudent(true);
    try {
      const currentNim = newStudent.nim.trim();
      await apiRequest('/api/students', {
        method: 'POST',
        token,
        body: {
          ...newStudent,
          semester: Number.parseInt(newStudent.semester, 10) || 1,
        },
      });

      const params = new URLSearchParams();
      if (studentSearch.trim()) params.set('q', studentSearch.trim());
      if (studentProdiFilter !== 'ALL') params.set('prodi', studentProdiFilter);
      if (completenessFilter !== 'ALL') params.set('completeness', completenessFilter);

      const refreshed = await apiRequest<{
        students: StudentRecord[];
        prodiList: string[];
        importLogs: ImportLog[];
        completenessStats?: StudentCompletenessStats;
      }>(`/api/students?${params.toString()}`, { token });

      setStudents(refreshed.students);
      setProdiList(refreshed.prodiList);
      setImportLogs(refreshed.importLogs);
      if (refreshed.completenessStats) {
        setCompletenessStats(refreshed.completenessStats);
      }
      await loadRequests();

      if (advanceNext) {
        const nextStudent =
          refreshed.students.find(
            (s) => s.nim !== currentNim && getMissingStudentFields(s).length > 0
          ) || refreshed.students.find((s) => s.nim !== currentNim);

        if (nextStudent) {
          openEditStudentModal(nextStudent);
          return;
        }
      }

      setShowAddStudent(false);
      setEditingExistingStudent(false);
      setNewStudent({
        nim: '',
        nik: '',
        nama: '',
        tempat_lahir: '',
        tanggal_lahir: '',
        jenis_kelamin: 'Perempuan',
        jenjang: 'SARJANA (S1)',
        prodi: 'MANAJEMEN',
        fakultas: 'Fakultas Ekonomi',
        angkatan: '2025',
        semester: '3',
        ipk: '3.50',
        email: '',
        no_hp: '',
        alamat: '',
        status_akademik: 'Aktif',
      });
    } catch (err) {
      setAddStudentError(err instanceof Error ? err.message : 'Gagal menyimpan mahasiswa.');
    } finally {
      setSavingStudent(false);
    }
  }

  async function handleAddSingleStudent(e: FormEvent) {
    e.preventDefault();
    await saveStudentRecord(false);
  }

  async function handleDeleteStudent(nim: string) {
    try {
      await apiRequest(`/api/students/${encodeURIComponent(nim)}`, {
        method: 'DELETE',
        token,
      });
      setConfirmDeleteNim(null);
      await loadStudents();
      await loadRequests();
    } catch {
      // ignore
    }
  }

  async function handleDownloadBackup() {
    setBackupFeedback(null);
    setExportingBackup(true);
    try {
      const blob = await fetchProtectedBlob('/api/staff/backup/export', token);
      const url = URL.createObjectURL(blob);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
        now.getHours()
      )}${pad(now.getMinutes())}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `cadangan-data-setting-fe-unikaltar-${stamp}.fe-backup.gz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupFeedback({
        type: 'ok',
        text: 'File cadangan lengkap (seluruh data & pengaturan) berhasil diunduh ke hardisk lokal.',
      });
    } catch (err) {
      setBackupFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengunduh file cadangan.',
      });
    } finally {
      setExportingBackup(false);
    }
  }

  async function handleInspectBackupFile(file: File | null) {
    if (!file) return;
    setBackupFeedback(null);
    setPendingRestoreFile(null);
    setInspectedBackup(null);
    setInspectingBackup(true);
    try {
      const fd = new FormData();
      fd.append('backup', file);
      const res = await apiUpload<{ summary: BackupSummary }>(
        '/api/staff/backup/inspect',
        fd,
        token
      );
      setPendingRestoreFile(file);
      setInspectedBackup(res.summary);
    } catch (err) {
      setBackupFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'File cadangan tidak valid atau tidak dapat dibaca.',
      });
    } finally {
      setInspectingBackup(false);
    }
  }

  async function handleConfirmRestoreBackup() {
    if (!pendingRestoreFile) return;
    setBackupFeedback(null);
    setRestoringBackup(true);
    try {
      const fd = new FormData();
      fd.append('backup', pendingRestoreFile);
      const res = await apiUpload<{
        summary: BackupSummary;
        services: LetterServiceDefinition[];
        templateSettings: LetterTemplateSettings;
      }>('/api/staff/backup/restore', fd, token);

      if (Array.isArray(res.services) && res.services.length > 0) {
        setServices(res.services.map((s) => normalizeServiceDef(s)));
      }
      if (res.templateSettings) {
        setTemplateSettings(res.templateSettings);
        setSettingsDraft(res.templateSettings);
      }

      setPendingRestoreFile(null);
      setInspectedBackup(null);
      await Promise.all([loadRequests(), loadStudents(), loadBackupSummary(), loadStaffAccounts()]);

      setBackupFeedback({
        type: 'ok',
        text: `Pemulihan selesai: ${res.summary.counts.students.toLocaleString(
          'id-ID'
        )} data mahasiswa, ${res.summary.counts.letterRequests} pengajuan surat, ${
          res.summary.counts.settings
        } pengaturan sistem, dan ${
          res.summary.counts.uploadFiles + res.summary.counts.signatureFiles
        } file berkas berhasil dipulihkan.`,
      });
    } catch (err) {
      setBackupFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal memulihkan data dan pengaturan dari file cadangan.',
      });
    } finally {
      setRestoringBackup(false);
    }
  }

  function handleStudentColumnSort(column: Exclude<StudentSortBy, 'default'>) {
    if (studentSortBy === column) {
      setStudentSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setStudentSortBy(column);
      setStudentSortDir(column === 'angkatan' ? 'desc' : 'asc');
    }
  }

  async function handleCreateStaffAccount(e: FormEvent) {
    e.preventDefault();
    setStaffAccountFeedback(null);

    const fullName = newStaffFullName.trim();
    const username = newStaffUsername.trim().toLowerCase();
    const roleTitle = newStaffRoleTitle.trim() || 'Staf Administrasi Akademik';
    const passcode = newStaffPasscode.trim();

    if (!fullName) {
      setStaffAccountFeedback({ type: 'err', text: 'Nama lengkap staf wajib diisi.' });
      return;
    }
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      setStaffAccountFeedback({
        type: 'err',
        text: 'Username harus 3–40 karakter (huruf kecil, angka, titik, _, atau -).',
      });
      return;
    }
    if (passcode.length < 6) {
      setStaffAccountFeedback({
        type: 'err',
        text: 'Kata sandi staf baru minimal 6 karakter.',
      });
      return;
    }
    if (passcode !== newStaffPasscodeConfirm.trim()) {
      setStaffAccountFeedback({
        type: 'err',
        text: 'Konfirmasi kata sandi staf baru tidak cocok.',
      });
      return;
    }

    setSavingNewStaff(true);
    try {
      const res = await apiRequest<{ account: StaffAccount }>('/api/staff/accounts', {
        method: 'POST',
        token,
        body: {
          full_name: fullName,
          username,
          role_title: roleTitle,
          passcode,
        },
      });
      setStaffAccounts((prev) => [...prev, res.account]);
      setNewStaffFullName('');
      setNewStaffUsername('');
      setNewStaffRoleTitle('Staf Administrasi Akademik');
      setNewStaffPasscode('');
      setNewStaffPasscodeConfirm('');
      setStaffAccountFeedback({
        type: 'ok',
        text: `Akun staf "${res.account.full_name}" (username: ${res.account.username}) berhasil ditambahkan dan siap digunakan untuk masuk.`,
      });
    } catch (err) {
      setStaffAccountFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menambahkan staf administrasi baru.',
      });
    } finally {
      setSavingNewStaff(false);
    }
  }

  async function handleToggleStaffActive(acc: StaffAccount) {
    setStaffAccountFeedback(null);
    setTogglingStaffId(acc.id);
    try {
      const res = await apiRequest<{ account: StaffAccount }>(
        `/api/staff/accounts/${encodeURIComponent(acc.id)}`,
        {
          method: 'PATCH',
          token,
          body: { is_active: !acc.is_active },
        }
      );
      setStaffAccounts((prev) => prev.map((item) => (item.id === acc.id ? res.account : item)));
      setStaffAccountFeedback({
        type: 'ok',
        text: `Akun "${res.account.full_name}" ${
          res.account.is_active ? 'diaktifkan kembali' : 'dinonaktifkan'
        }.`,
      });
    } catch (err) {
      setStaffAccountFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal memperbarui status akun staf.',
      });
    } finally {
      setTogglingStaffId(null);
    }
  }

  function openEditStaffModal(acc: StaffAccount) {
    setEditingStaffAccount(acc);
    setEditStaffFullName(acc.full_name);
    setEditStaffRoleTitle(acc.role_title);
    setEditStaffNewPasscode('');
    setEditStaffNewPasscodeConfirm('');
    setShowEditStaffPasscode(false);
    setEditStaffError(null);
  }

  async function handleSaveEditStaffAccount(e: FormEvent) {
    e.preventDefault();
    if (!editingStaffAccount) return;
    setEditStaffError(null);

    const fullName = editStaffFullName.trim();
    const roleTitle = editStaffRoleTitle.trim() || 'Staf Administrasi Akademik';
    const nextPass = editStaffNewPasscode.trim();

    if (!fullName) {
      setEditStaffError('Nama lengkap staf wajib diisi.');
      return;
    }
    if (nextPass && nextPass.length < 6) {
      setEditStaffError('Kata sandi baru minimal 6 karakter.');
      return;
    }
    if (nextPass && nextPass !== editStaffNewPasscodeConfirm.trim()) {
      setEditStaffError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }

    setSavingEditStaff(true);
    try {
      const res = await apiRequest<{ account: StaffAccount }>(
        `/api/staff/accounts/${encodeURIComponent(editingStaffAccount.id)}`,
        {
          method: 'PATCH',
          token,
          body: {
            full_name: fullName,
            role_title: roleTitle,
            new_passcode: nextPass || undefined,
          },
        }
      );
      setStaffAccounts((prev) =>
        prev.map((item) => (item.id === editingStaffAccount.id ? res.account : item))
      );
      setEditingStaffAccount(null);
      setStaffAccountFeedback({
        type: 'ok',
        text: `Data akun "${res.account.full_name}" berhasil diperbarui${
          nextPass ? ' termasuk kata sandi barunya' : ''
        }.`,
      });
    } catch (err) {
      setEditStaffError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan akun staf.');
    } finally {
      setSavingEditStaff(false);
    }
  }

  async function handleDeleteStaffAccount(id: string) {
    setStaffAccountFeedback(null);
    setDeletingStaffId(id);
    try {
      await apiRequest(`/api/staff/accounts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        token,
      });
      setStaffAccounts((prev) => prev.filter((item) => item.id !== id));
      setConfirmDeleteStaffId(null);
      setStaffAccountFeedback({
        type: 'ok',
        text: 'Akun staf administrasi berhasil dihapus.',
      });
    } catch (err) {
      setStaffAccountFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menghapus akun staf.',
      });
    } finally {
      setDeletingStaffId(null);
    }
  }

  return (
    <div className="min-h-screen bg-amber-50/40 flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside
        className={`${
          mobileNavOpen ? 'fixed inset-0 z-40 flex' : 'hidden lg:flex'
        } lg:w-[260px] lg:shrink-0 lg:flex-col bg-white border-r border-amber-200`}
      >
        <div className="w-[260px] flex flex-col h-full bg-white">
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

          <div className="px-6 py-4 border-b border-amber-200 bg-amber-50/70">
            <p className="text-xs text-stone-500">Petugas Aktif</p>
            <p className="text-sm font-semibold text-stone-950 mt-0.5 truncate">{staffName}</p>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Navigasi Staf">
            <button
              type="button"
              onClick={() => {
                setTab('requests');
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'requests'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-stone-700 hover:bg-amber-50 hover:text-orange-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Inbox className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">Antrean Verifikasi</span>
              </span>
              <span
                className={`text-xs font-mono tabular-nums ${
                  tab === 'requests' ? 'text-amber-100' : 'text-stone-500'
                }`}
              >
                {stats.pendingRequests}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('students');
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'students'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-stone-700 hover:bg-amber-50 hover:text-orange-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">Data Mahasiswa (Excel)</span>
              </span>
              <span
                className={`text-xs font-mono tabular-nums ${
                  tab === 'students' ? 'text-amber-100' : 'text-stone-500'
                }`}
              >
                {stats.totalStudents}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('forms');
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'forms'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-stone-700 hover:bg-amber-50 hover:text-orange-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <SlidersHorizontal className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">Formulir Layanan Surat</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('backup');
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'backup'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-stone-700 hover:bg-amber-50 hover:text-orange-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <HardDrive className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">Cadangkan & Pulihkan</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('staff');
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'staff'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-stone-700 hover:bg-amber-50 hover:text-orange-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">Kelola Staf</span>
              </span>
              {staffAccounts.length > 0 && (
                <span
                  className={`text-xs font-mono tabular-nums ${
                    tab === 'staff' ? 'text-amber-100' : 'text-stone-500'
                  }`}
                >
                  {staffAccounts.length}
                </span>
              )}
            </button>
          </nav>
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
        <header className="h-16 bg-white border-b border-amber-200 px-6 flex items-center justify-between gap-4">
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
              <span>Staf Administrasi</span>
              <span className="mx-2 text-amber-400">/</span>
              <span className="font-semibold text-stone-950">
                {tab === 'requests'
                  ? 'Verifikasi Pengajuan Surat'
                  : tab === 'students'
                  ? 'Basis Data Mahasiswa & Impor Excel'
                  : tab === 'forms'
                  ? 'Pengaturan Formulir Layanan & Pejabat Dekan'
                  : tab === 'staff'
                  ? 'Kelola Akun Staf Administrasi'
                  : 'Cadangkan & Pulihkan Data serta Pengaturan'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact className="hidden md:inline-flex" />
            {tab === 'requests' ? (
              <button
                type="button"
                onClick={() => setTab('students')}
                className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 transition-colors whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Impor Data Excel</span>
              </button>
            ) : tab === 'students' ? (
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-orange-600" aria-hidden="true" />
                <span>Unduh Template Excel</span>
              </button>
            ) : tab === 'backup' ? (
              <button
                type="button"
                disabled={exportingBackup}
                onClick={handleDownloadBackup}
                className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                {exportingBackup ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>Simpan Cadangan ke Hardisk</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setTab('requests')}
                className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Inbox className="w-3.5 h-3.5 text-orange-600" aria-hidden="true" />
                <span>Ke Antrean Verifikasi</span>
              </button>
            )}

            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 text-orange-600" aria-hidden="true" />
              <span className="hidden sm:inline">Keluar Staf</span>
              <span className="sm:hidden">Keluar</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8 max-w-[1440px] w-full mx-auto space-y-6">
          {/* Metric Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-amber-200 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-amber-200">
            <div className="p-5">
              <p className="text-xs text-stone-500">Total Pengajuan Surat</p>
              <p className="text-2xl font-bold text-stone-950 mt-1 tabular-nums">
                {stats.totalRequests}
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs text-stone-500">Menunggu / Diproses</p>
              <p className="text-2xl font-bold text-orange-700 mt-1 tabular-nums">
                {stats.pendingRequests}
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs text-stone-500">Surat Diterbitkan</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                {stats.approvedRequests}
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs text-stone-500">Mahasiswa Terdaftar</p>
              <p className="text-2xl font-bold text-amber-700 mt-1 tabular-nums">
                {stats.totalStudents}
              </p>
            </div>
          </div>

          {/* VIEW 1: ANTREAN VERIFIKASI DIGITAL */}
          {tab === 'requests' && (
            <div className="space-y-4">
              {/* Filter Toolbar */}
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-amber-100/70 border border-amber-200 rounded-lg">
                  {(
                    [
                      'ALL',
                      'Menunggu Berkas',
                      'Menunggu Verifikasi',
                      'Sedang Diproses',
                      'Perlu Revisi',
                      'Disetujui',
                      'Ditolak',
                    ] as const
                  ).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        statusFilter === st
                          ? 'bg-orange-600 text-white shadow-sm'
                          : 'text-stone-700 hover:text-orange-800'
                      }`}
                    >
                      {st === 'ALL' ? 'Semua Status' : st}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={letterTypeFilter}
                    onChange={(e) => setLetterTypeFilter(e.target.value)}
                    aria-label="Filter jenis surat"
                    className="px-3 py-2 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                  >
                    <option value="ALL">Semua Jenis Surat</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.shortTitle}
                      </option>
                    ))}
                  </select>

                  <div className="relative w-64">
                    <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={reqSearch}
                      onChange={(e) => setReqSearch(e.target.value)}
                      placeholder="Cari NIM, nama, atau kode..."
                      className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={loadRequests}
                    className="p-2 text-orange-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
                    aria-label="Segarkan antrean"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Split View: Tabel Antrean + Panel Pemeriksaan Digital */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                {/* Daftar Antrean */}
                <div className="xl:col-span-6 bg-white border border-amber-200 rounded-lg overflow-hidden">
                  {loadingRequests ? (
                    <div className="p-6 space-y-3">
                      <div className="h-10 bg-amber-100/60 rounded animate-pulse" />
                      <div className="h-10 bg-amber-100/60 rounded animate-pulse" />
                      <div className="h-10 bg-amber-100/60 rounded animate-pulse" />
                    </div>
                  ) : requests.length === 0 ? (
                    <div className="p-10 text-center">
                      <FileText className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-stone-900">
                        Tidak ada pengajuan surat pada filter ini
                      </p>
                      <p className="text-xs text-stone-500 mt-1">
                        Ubah filter status atau tunggu mahasiswa mengirimkan permohonan baru.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-amber-200 bg-amber-100/70 text-xs font-semibold text-amber-950">
                            <th className="py-3 px-4">Mahasiswa</th>
                            <th className="py-3 px-4">Layanan Surat</th>
                            <th className="py-3 px-4">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100 text-xs">
                          {requests.map((req) => {
                            const srv = getLetterService(req.letter_type, services);
                            const isSelected = req.id === selectedId;
                            return (
                              <tr
                                key={req.id}
                                onClick={() => setSelectedId(req.id)}
                                className={`cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-amber-100/80'
                                    : 'hover:bg-amber-50/60'
                                }`}
                              >
                                <td className="py-3 px-4">
                                  <p className="font-semibold text-stone-950">
                                    {req.student?.nama || req.student_nim}
                                  </p>
                                  <p className="font-mono text-stone-500 mt-0.5 tabular-nums">
                                    {req.student_nim} · {req.tracking_code}
                                  </p>
                                </td>
                                <td className="py-3 px-4">
                                  <p className="font-medium text-stone-800">
                                    {srv?.shortTitle || req.letter_type}
                                  </p>
                                  <p className="text-stone-500 mt-0.5 tabular-nums">
                                    {formatTanggalIndonesia(req.created_at)} ·{' '}
                                    {req.documents?.length || 0} lampiran
                                  </p>
                                </td>
                                <td className="py-3 px-4">
                                  <StatusIndicator status={req.status} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Panel Verifikasi Digital */}
                <div className="xl:col-span-6 bg-white border border-amber-200 rounded-lg overflow-hidden">
                  {!selectedRequest ? (
                    <div className="p-10 text-center text-sm text-stone-500">
                      Pilih salah satu pengajuan dari tabel antrean untuk memeriksa dokumen dan
                      melakukan verifikasi digital.
                    </div>
                  ) : (
                    <div className="divide-y divide-amber-200">
                      {/* Header Panel */}
                      <div className="p-5 bg-amber-50/70 flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-stone-500">
                            <span className="font-mono font-semibold text-orange-700">
                              {selectedRequest.tracking_code}
                            </span>
                            <span aria-hidden="true">·</span>
                            <StatusIndicator status={selectedRequest.status} />
                          </div>
                          <h2 className="text-base font-bold text-stone-950 mt-1">
                            {getLetterService(selectedRequest.letter_type, services)?.title}
                          </h2>
                        </div>

                        {selectedRequest.status === 'Disetujui' && (
                          <div className="flex items-center gap-2 shrink-0">
                            {selectedRequest.letter_type === 'PINDAH_KULIAH' ? (
                              selectedRequest.manual_pdf_name ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openManualPdfPreview(selectedRequest)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 whitespace-nowrap"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Lihat PDF</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadManualPdf(selectedRequest)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-950 bg-amber-300 rounded-md hover:bg-amber-400 whitespace-nowrap"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Unduh Surat PDF</span>
                                  </button>
                                </>
                              ) : null
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAutoDownloadPdf(false);
                                    setOfficialLetterReq(selectedRequest);
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 whitespace-nowrap"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  <span>Lihat Surat</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAutoDownloadPdf(true);
                                    setOfficialLetterReq(selectedRequest);
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-950 bg-amber-300 rounded-md hover:bg-amber-400 whitespace-nowrap"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Simpan PDF</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Data Mahasiswa Terverifikasi Excel */}
                      <div className="p-5 space-y-2">
                        <h3 className="text-xs font-semibold text-stone-700">
                          01. Kecocokan Data Mahasiswa (Basis Data Excel)
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-amber-50/50 p-3.5 border border-amber-200 rounded-md">
                          <div>
                            <span className="text-stone-500 block">Nama Lengkap</span>
                            <span className="font-semibold text-stone-950">
                              {selectedRequest.student?.nama || '-'}
                            </span>
                          </div>
                          <div>
                            <span className="text-stone-500 block">NIM</span>
                            <span className="font-mono font-semibold text-stone-950">
                              {selectedRequest.student_nim}
                            </span>
                          </div>
                          <div>
                            <span className="text-stone-500 block">Status Akademik</span>
                            <span className="font-semibold text-stone-950">
                              {selectedRequest.student?.status_akademik || '-'}
                            </span>
                          </div>
                          <div>
                            <span className="text-stone-500 block">Program Studi</span>
                            <span className="font-medium text-stone-900">
                              {selectedRequest.student?.prodi || '-'}
                            </span>
                          </div>
                          <div>
                            <span className="text-stone-500 block">Semester / IPK</span>
                            <span className="font-medium text-stone-900 tabular-nums">
                              Smt {selectedRequest.student?.semester || '-'} · IPK{' '}
                              {selectedRequest.student?.ipk || '-'}
                            </span>
                          </div>
                          <div>
                            <span className="text-stone-500 block">Email Kampus</span>
                            <span className="font-medium text-stone-900 truncate block">
                              {selectedRequest.student?.email || '-'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Rincian Formulir + Fitur Edit Formulir Staf */}
                      <div className="p-5 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-xs font-semibold text-stone-700">
                            02. Data Formulir Pengajuan
                          </h3>
                          {!editingForm ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEditFormValues({ ...(selectedRequest.form_data || {}) });
                                setEditFormError(null);
                                setEditingForm(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded hover:bg-amber-50 transition-colors"
                            >
                              <Pencil className="w-3 h-3 text-orange-600" aria-hidden="true" />
                              <span>Edit Formulir</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingForm(false);
                                setEditFormError(null);
                              }}
                              className="text-xs font-medium text-stone-500 hover:text-stone-900"
                            >
                              Batal Edit
                            </button>
                          )}
                        </div>

                        {!editingForm ? (
                          <dl className="divide-y divide-amber-100 border border-amber-200 rounded-md">
                            {(
                              getLetterService(selectedRequest.letter_type, services)?.formFields || []
                            ).map((field) => (
                              <div
                                key={field.name}
                                className="px-3.5 py-2 text-xs flex justify-between gap-4"
                              >
                                <dt className="text-stone-500">{field.label}</dt>
                                <dd className="text-stone-950 font-medium text-right">
                                  {selectedRequest.form_data[field.name] || '-'}
                                </dd>
                              </div>
                            ))}
                            {Object.entries(selectedRequest.form_data)
                              .filter(
                                ([k]) =>
                                  !(
                                    getLetterService(selectedRequest.letter_type, services)
                                      ?.formFields || []
                                  ).some((f) => f.name === k)
                              )
                              .map(([k, v]) => (
                                <div
                                  key={k}
                                  className="px-3.5 py-2 text-xs flex justify-between gap-4"
                                >
                                  <dt className="text-stone-500 capitalize">
                                    {k.replace(/_/g, ' ')}
                                  </dt>
                                  <dd className="text-stone-950 font-medium text-right">
                                    {v || '-'}
                                  </dd>
                                </div>
                              ))}
                          </dl>
                        ) : (
                          <form
                            onSubmit={handleSaveFormEdit}
                            className="p-4 border border-amber-300 bg-amber-50/50 rounded-md space-y-3"
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {(
                                getLetterService(selectedRequest.letter_type, services)?.formFields ||
                                []
                              ).map((field) => (
                                <div
                                  key={field.name}
                                  className={field.type === 'textarea' ? 'sm:col-span-2' : ''}
                                >
                                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                                    {field.label}{' '}
                                    {field.required && <span className="text-rose-600">*</span>}
                                  </label>
                                  {field.type === 'textarea' ? (
                                    <textarea
                                      rows={2}
                                      value={editFormValues[field.name] || ''}
                                      onChange={(e) =>
                                        setEditFormValues((prev) => ({
                                          ...prev,
                                          [field.name]: e.target.value,
                                        }))
                                      }
                                      className="w-full px-3 py-1.5 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                                    />
                                  ) : field.type === 'select' ? (
                                    <select
                                      value={editFormValues[field.name] || ''}
                                      onChange={(e) =>
                                        setEditFormValues((prev) => ({
                                          ...prev,
                                          [field.name]: e.target.value,
                                        }))
                                      }
                                      className="w-full px-3 py-1.5 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                                    >
                                      <option value="">{field.placeholder}</option>
                                      {editFormValues[field.name] &&
                                        !field.options?.includes(editFormValues[field.name]) && (
                                          <option value={editFormValues[field.name]}>
                                            {editFormValues[field.name]}
                                          </option>
                                        )}
                                      {field.options?.map((opt) => (
                                        <option key={opt} value={opt}>
                                          {opt}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      type={field.type}
                                      value={editFormValues[field.name] || ''}
                                      onChange={(e) =>
                                        setEditFormValues((prev) => ({
                                          ...prev,
                                          [field.name]: e.target.value,
                                        }))
                                      }
                                      className="w-full px-3 py-1.5 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                                    />
                                  )}
                                </div>
                              ))}
                            </div>

                            {editFormError && (
                              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded">
                                {editFormError}
                              </p>
                            )}

                            <div className="flex justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingForm(false);
                                  setEditFormError(null);
                                }}
                                className="px-3 py-1.5 text-xs font-semibold text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
                              >
                                Batal
                              </button>
                              <button
                                type="submit"
                                disabled={savingFormEdit}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
                              >
                                {savingFormEdit ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Save className="w-3.5 h-3.5" />
                                )}
                                <span>Simpan Perubahan Formulir</span>
                              </button>
                            </div>
                          </form>
                        )}
                      </div>

                      {/* Pemeriksaan Dokumen Pendukung */}
                      <div className="p-5 space-y-2.5">
                        <h3 className="text-xs font-semibold text-stone-700">
                          03. Berkas Dokumen Pendukung
                        </h3>
                        {(selectedRequest.documents || []).length === 0 ? (
                          <p className="text-xs text-stone-500">Tidak ada lampiran berkas.</p>
                        ) : (
                          <div className="space-y-2">
                            {(selectedRequest.documents || []).map((doc) => (
                              <div
                                key={doc.id}
                                className="flex items-center justify-between gap-3 p-3 border border-amber-200 rounded-md text-xs"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-stone-900 truncate">
                                    {doc.doc_type}
                                  </p>
                                  <p className="text-stone-500 truncate mt-0.5">
                                    {doc.original_name} · {formatBytes(doc.size_bytes)}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setPreviewDoc(doc)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 rounded shrink-0"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Pratinjau Berkas</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Daftar Periksa & Keputusan Verifikasi */}
                      <div className="p-5 space-y-4">
                        <h3 className="text-xs font-semibold text-stone-700">
                          04. Daftar Periksa & Keputusan Verifikasi Digital
                        </h3>

                        <div className="space-y-2">
                          {checklist.map((item) => (
                            <label
                              key={item.id}
                              className="flex items-start gap-2.5 text-xs text-stone-800 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={item.checked}
                                onChange={(e) =>
                                  setChecklist((prev) =>
                                    prev.map((c) =>
                                      c.id === item.id ? { ...c, checked: e.target.checked } : c
                                    )
                                  )
                                }
                                className="mt-0.5 rounded border-amber-300 text-orange-600 focus:ring-orange-600"
                              />
                              <span>{item.label}</span>
                            </label>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              Nomor Surat Resmi (Otomatis Berurutan &amp; Bulan Romawi)
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={officialNumber}
                                onChange={(e) => setOfficialNumber(e.target.value)}
                                placeholder={
                                  nextAutoOfficialNumber ||
                                  `001/${templateSettings.number_middle_code || 'FE.UNIKALTAR/YAPETAS'}/${getRomanMonth()}/${new Date().getFullYear()}`
                                }
                                className="flex-1 px-3 py-2 text-xs font-mono border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (nextAutoOfficialNumber) {
                                    setOfficialNumber(nextAutoOfficialNumber);
                                  }
                                }}
                                disabled={!nextAutoOfficialNumber}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-800 bg-amber-50 border border-amber-300 rounded-md hover:bg-amber-100 shrink-0 disabled:opacity-50"
                                title="Isi ulang dengan nomor urut berikutnya"
                              >
                                <RefreshCw className="w-3.5 h-3.5 text-orange-600" aria-hidden="true" />
                                <span>Isi Otomatis</span>
                              </button>
                            </div>
                            <p className="text-[11px] text-stone-500 mt-1">
                              Terisi otomatis berurutan dengan kode bulan angka Romawi (
                              <span className="font-mono font-semibold text-stone-700">
                                {getRomanMonth()}
                              </span>
                              ) mengikuti bulan pembuatan surat. Dapat disesuaikan manual bila perlu.
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              Pejabat Penandatangan
                            </label>
                            <input
                              type="text"
                              value={signatoryName}
                              onChange={(e) => setSignatoryName(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              NIDN Penandatangan
                            </label>
                            <input
                              type="text"
                              value={signatoryNidn}
                              onChange={(e) => setSignatoryNidn(e.target.value)}
                              className="w-full px-3 py-2 text-xs font-mono border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              Jabatan Penandatangan
                            </label>
                            <input
                              type="text"
                              value={signatoryTitle}
                              onChange={(e) => setSignatoryTitle(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              NIK Penandatangan
                            </label>
                            <input
                              type="text"
                              value={signatoryNik}
                              onChange={(e) => setSignatoryNik(e.target.value)}
                              className="w-full px-3 py-2 text-xs font-mono border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-stone-700 mb-1">
                            Catatan Verifikasi (Wajib diisi jika Minta Revisi / Tolak)
                          </label>
                          <textarea
                            rows={2}
                            value={verificationNotes}
                            onChange={(e) => setVerificationNotes(e.target.value)}
                            placeholder="Tuliskan hasil pemeriksaan dokumen atau instruksi perbaikan..."
                            className="w-full px-3 py-2 text-xs border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                          />
                        </div>

                        {selectedRequest.letter_type === 'PINDAH_KULIAH' && (
                          <div className="p-4 border border-amber-300 bg-amber-50/70 rounded-lg space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold text-amber-950">
                                  Langkah 3 · Unggah File PDF Surat Pindah Manual
                                </p>
                                <p className="text-[11px] text-stone-600 mt-0.5 leading-relaxed">
                                  Surat Pindah Kuliah dibuat secara manual oleh staf. Setelah ke-3
                                  berkas pada Langkah 2 lengkap dan disetujui untuk diproses, unggah
                                  file PDF Surat Pindah di sini agar dapat diunduh mahasiswa saat
                                  status <span className="font-semibold">Disetujui</span>.
                                </p>
                              </div>
                              <div className="shrink-0">
                                <input
                                  ref={manualPdfInputRef}
                                  type="file"
                                  accept=".pdf,application/pdf"
                                  className="sr-only"
                                  onChange={handleUploadManualPdf}
                                />
                                <button
                                  type="button"
                                  disabled={uploadingManualPdf}
                                  onClick={() => manualPdfInputRef.current?.click()}
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60 whitespace-nowrap"
                                >
                                  {uploadingManualPdf ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Upload className="w-3.5 h-3.5" />
                                  )}
                                  <span>
                                    {selectedRequest.manual_pdf_name
                                      ? 'Ganti File PDF Surat'
                                      : 'Unggah File PDF Surat'}
                                  </span>
                                </button>
                              </div>
                            </div>

                            {selectedRequest.manual_pdf_name ? (
                              <div className="p-3 bg-white border border-emerald-300 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                <div className="min-w-0">
                                  <p className="font-semibold text-emerald-900 truncate">
                                    File PDF Terunggah: {selectedRequest.manual_pdf_name}
                                  </p>
                                  <p className="text-[11px] text-stone-500 mt-0.5">
                                    {selectedRequest.manual_pdf_size
                                      ? formatBytes(selectedRequest.manual_pdf_size)
                                      : ''}
                                    {selectedRequest.manual_pdf_uploaded_at
                                      ? ` · Diunggah ${formatTanggalIndonesia(
                                          selectedRequest.manual_pdf_uploaded_at
                                        )}`
                                      : ''}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => openManualPdfPreview(selectedRequest)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 rounded"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Pratinjau</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadManualPdf(selectedRequest)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-stone-800 bg-white border border-amber-300 hover:bg-amber-50 rounded"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Unduh</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-[11px] font-medium text-amber-900 bg-amber-100/80 border border-amber-300 px-3 py-2 rounded">
                                Belum ada file PDF Surat Pindah yang diunggah. Unggah file PDF
                                manual terlebih dahulu sebelum mengklik &ldquo;Setujui &amp;
                                Terbitkan Surat&rdquo;.
                              </p>
                            )}
                          </div>
                        )}

                        {verifyFeedback && (
                          <div
                            role="status"
                            className={`p-3 text-xs rounded-md border ${
                              verifyFeedback.type === 'ok'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                : 'bg-rose-50 border-rose-200 text-rose-800'
                            }`}
                          >
                            {verifyFeedback.text}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-2">
                          <button
                            type="button"
                            disabled={
                              savingVerify ||
                              (selectedRequest.letter_type === 'PINDAH_KULIAH' &&
                                !selectedRequest.manual_pdf_name)
                            }
                            onClick={() => handleVerifyDecision('Disetujui')}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50"
                          >
                            {savingVerify && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>Setujui & Terbitkan Surat</span>
                          </button>

                          <button
                            type="button"
                            disabled={savingVerify}
                            onClick={() => handleVerifyDecision('Sedang Diproses')}
                            className="px-3.5 py-2 text-xs font-semibold text-amber-950 bg-amber-300 border border-amber-400 rounded-md hover:bg-amber-400 disabled:opacity-60"
                          >
                            Tandai Diproses
                          </button>

                          <button
                            type="button"
                            disabled={savingVerify}
                            onClick={() => handleVerifyDecision('Perlu Revisi')}
                            className="px-3.5 py-2 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-300 rounded-md hover:bg-orange-100 disabled:opacity-60"
                          >
                            Minta Revisi
                          </button>

                          <button
                            type="button"
                            disabled={savingVerify}
                            onClick={() => handleVerifyDecision('Ditolak')}
                            className="px-3.5 py-2 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-md hover:bg-rose-100 disabled:opacity-60"
                          >
                            Tolak
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: DATA MAHASISWA & IMPOR EXCEL OTOMATIS */}
          {tab === 'students' && (
            <div className="space-y-6">
              {/* Panel Kelengkapan Basis Data Mahasiswa */}
              {completenessStats && (
                <div className="bg-white border border-amber-200 rounded-lg p-6 space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-stone-950">
                        Kelengkapan Basis Data Mahasiswa
                      </h2>
                      <p className="text-xs text-stone-600 mt-1">
                        Pantau data biodata mahasiswa yang masih kosong (NIK, Tempat/Tanggal Lahir,
                        Email, No. HP, Alamat) dan lengkapi secara manual maupun lewat Excel.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleDownloadIncompleteExcel}
                        disabled={completenessStats.incompleteCount === 0}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5 text-orange-600" />
                        <span>
                          Unduh Excel Data Kosong ({completenessStats.incompleteCount})
                        </span>
                      </button>
                      {completenessStats.incompleteCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const firstIncomplete =
                              students.find((s) => getMissingStudentFields(s).length > 0) ||
                              students[0];
                            if (firstIncomplete) openEditStudentModal(firstIncomplete);
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 whitespace-nowrap"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Mulai Lengkapi Data</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setCompletenessFilter('ALL')}
                      className={`p-3 border rounded-md text-left transition-colors ${
                        completenessFilter === 'ALL'
                          ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                          : 'border-amber-200 bg-amber-50/50 text-stone-800 hover:border-orange-300'
                      }`}
                    >
                      <span className="block opacity-80">Total Basis Data</span>
                      <span className="text-lg font-bold tabular-nums mt-0.5 block">
                        {completenessStats.total}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCompletenessFilter('INCOMPLETE')}
                      className={`p-3 border rounded-md text-left transition-colors ${
                        completenessFilter === 'INCOMPLETE'
                          ? 'border-amber-500 bg-amber-400 text-amber-950 shadow-sm'
                          : 'border-amber-200 bg-amber-50/80 text-amber-950 hover:border-amber-400'
                      }`}
                    >
                      <span className="block opacity-85">Belum Lengkap</span>
                      <span className="text-lg font-bold tabular-nums mt-0.5 block">
                        {completenessStats.incompleteCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCompletenessFilter('MISSING_NIK')}
                      className={`p-3 border rounded-md text-left transition-colors ${
                        completenessFilter === 'MISSING_NIK'
                          ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                          : 'border-amber-200 bg-white text-stone-800 hover:border-orange-300'
                      }`}
                    >
                      <span className="block opacity-80">NIK Kosong</span>
                      <span className="text-lg font-bold tabular-nums mt-0.5 block">
                        {completenessStats.missingCounts.nik}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCompletenessFilter('MISSING_TTL')}
                      className={`p-3 border rounded-md text-left transition-colors ${
                        completenessFilter === 'MISSING_TTL'
                          ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                          : 'border-amber-200 bg-white text-stone-800 hover:border-orange-300'
                      }`}
                    >
                      <span className="block opacity-80">Tpt/Tgl Lahir Kosong</span>
                      <span className="text-lg font-bold tabular-nums mt-0.5 block">
                        {Math.max(
                          completenessStats.missingCounts.tempat_lahir,
                          completenessStats.missingCounts.tanggal_lahir
                        )}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCompletenessFilter('MISSING_CONTACT')}
                      className={`p-3 border rounded-md text-left transition-colors ${
                        completenessFilter === 'MISSING_CONTACT'
                          ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                          : 'border-amber-200 bg-white text-stone-800 hover:border-orange-300'
                      }`}
                    >
                      <span className="block opacity-80">Email / HP Kosong</span>
                      <span className="text-lg font-bold tabular-nums mt-0.5 block">
                        {Math.max(
                          completenessStats.missingCounts.email,
                          completenessStats.missingCounts.no_hp
                        )}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCompletenessFilter('MISSING_ALAMAT')}
                      className={`p-3 border rounded-md text-left transition-colors ${
                        completenessFilter === 'MISSING_ALAMAT'
                          ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                          : 'border-amber-200 bg-white text-stone-800 hover:border-orange-300'
                      }`}
                    >
                      <span className="block opacity-80">Alamat Kosong</span>
                      <span className="text-lg font-bold tabular-nums mt-0.5 block">
                        {completenessStats.missingCounts.alamat}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Panel Unggah Excel */}
              <div className="bg-white border border-amber-200 rounded-lg p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-stone-950">
                      Impor Data Mahasiswa dari File Excel
                    </h2>
                    <p className="text-xs text-stone-600 mt-1">
                      Unggah file <span className="font-mono">.xlsx</span> atau{' '}
                      <span className="font-mono">.csv</span> untuk menambahkan data baru,
                      melengkapi kolom yang masih kosong, atau mengganti seluruh basis data lama.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 text-orange-600" />
                      <span>Unduh Template (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingExistingStudent(false);
                        setNewStudent({
                          nim: '',
                          nik: '',
                          nama: '',
                          tempat_lahir: '',
                          tanggal_lahir: '',
                          jenis_kelamin: 'Perempuan',
                          jenjang: 'SARJANA (S1)',
                          prodi: 'MANAJEMEN',
                          fakultas: 'Fakultas Ekonomi',
                          angkatan: '2025',
                          semester: '3',
                          ipk: '3.50',
                          email: '',
                          no_hp: '',
                          alamat: '',
                          status_akademik: 'Aktif',
                        });
                        setAddStudentError(null);
                        setShowAddStudent(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Manual</span>
                    </button>
                  </div>
                </div>

                {/* Mode Impor Excel */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setImportMode('upsert')}
                    className={`p-3.5 border rounded-md text-left transition-colors ${
                      importMode === 'upsert'
                        ? 'border-orange-600 bg-orange-600 text-white shadow-sm'
                        : 'border-amber-200 bg-amber-50/60 text-stone-800 hover:border-orange-300'
                    }`}
                  >
                    <p className="font-semibold">Tambah & Perbarui Data</p>
                    <p className="mt-1 opacity-85 leading-relaxed">
                      Menambah NPM baru & memperbarui kolom terisi, tanpa menimpa data dengan sel
                      Excel yang kosong.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportMode('fill_empty')}
                    className={`p-3.5 border rounded-md text-left transition-colors ${
                      importMode === 'fill_empty'
                        ? 'border-amber-500 bg-amber-400 text-amber-950 shadow-sm'
                        : 'border-amber-200 bg-amber-50/60 text-stone-800 hover:border-orange-300'
                    }`}
                  >
                    <p className="font-semibold">Lengkapi Kolom Kosong Saja</p>
                    <p className="mt-1 opacity-85 leading-relaxed">
                      Khusus mengisi kolom biodata (NIK, TTL, Email, HP, Alamat) yang masih kosong
                      di basis data.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportMode('replace')}
                    className={`p-3.5 border rounded-md text-left transition-colors ${
                      importMode === 'replace'
                        ? 'border-rose-700 bg-rose-700 text-white shadow-sm'
                        : 'border-amber-200 bg-amber-50/60 text-stone-800 hover:border-orange-300'
                    }`}
                  >
                    <p className="font-semibold">Ganti Seluruh Basis Data Lama</p>
                    <p className="mt-1 opacity-85 leading-relaxed">
                      Menghapus mahasiswa lama yang tidak ada di file Excel ini sehingga basis data
                      mengikuti isi file terbaru.
                    </p>
                  </button>
                </div>

                {/* Dropzone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    dragActive
                      ? 'border-orange-600 bg-amber-100/70'
                      : 'border-amber-300 bg-amber-50/50 hover:border-orange-400'
                  }`}
                >
                  <FileSpreadsheet className="w-8 h-8 text-orange-600 mx-auto mb-2.5" />
                  <p className="text-sm font-semibold text-stone-900">
                    {importingExcel
                      ? 'Memproses dan menyinkronkan data mahasiswa...'
                      : 'Seret dan lepas file Excel mahasiswa di sini'}
                  </p>
                  <p className="text-xs text-stone-600 mt-1 mb-4">
                    Mode aktif:{' '}
                    <strong className="text-stone-900">
                      {importMode === 'replace'
                        ? 'Ganti Seluruh Basis Data Lama'
                        : importMode === 'fill_empty'
                        ? 'Lengkapi Kolom Kosong Saja'
                        : 'Tambah & Perbarui Data'}
                    </strong>
                    . Mendukung header: NPM/NIM, Nama, NIK, Tempat/Tanggal Lahir, Jenis Kelamin,
                    Prodi, Jenjang, Email, No HP, Alamat, Status.
                  </p>
                  <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 cursor-pointer">
                    {importingExcel ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <span>Pilih File Excel dari Komputer</span>
                    <input
                      type="file"
                      accept=".xlsx,.csv"
                      disabled={importingExcel}
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        handleExcelFile(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                {importError && (
                  <div
                    role="alert"
                    className="p-3.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md"
                  >
                    {importError}
                  </div>
                )}

                {importSummary && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      <span>Sinkronisasi Excel Selesai</span>
                    </div>
                    <p className="text-xs text-emerald-900 tabular-nums">
                      Total baris dibaca: <strong>{importSummary.totalRows}</strong> · Data baru:{' '}
                      <strong>{importSummary.inserted}</strong> · Data diperbarui:{' '}
                      <strong>{importSummary.updated}</strong>
                      {typeof importSummary.deletedOld === 'number' &&
                      importSummary.deletedOld > 0 ? (
                        <>
                          {' '}
                          · Data lama dihapus: <strong>{importSummary.deletedOld}</strong>
                        </>
                      ) : null}{' '}
                      · Dilewati: <strong>{importSummary.skipped}</strong>
                    </p>
                    {importSummary.errors.length > 0 && (
                      <ul className="text-xs text-amber-900 list-disc pl-4">
                        {importSummary.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {importLogs.length > 0 && (
                  <div className="pt-2 border-t border-amber-200">
                    <p className="text-xs font-semibold text-stone-700 mb-2">
                      Riwayat Unggahan Excel Terakhir
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {importLogs.slice(0, 3).map((log) => (
                        <div
                          key={log.id}
                          className="p-3 border border-amber-200 rounded-md bg-amber-50/50 text-xs"
                        >
                          <p className="font-semibold text-stone-900 truncate">{log.filename}</p>
                          <p className="text-stone-600 mt-0.5 tabular-nums">
                            +{log.inserted_count} baru · {log.updated_count} diperbarui
                          </p>
                          <p className="text-stone-500 mt-0.5 tabular-nums">
                            {formatTanggalIndonesia(log.created_at)} · {log.imported_by}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Direktori Mahasiswa */}
              <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
                <div className="p-4 border-b border-amber-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-stone-950">
                    Daftar Mahasiswa Terdaftar ({students.length})
                  </h3>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={completenessFilter}
                      onChange={(e) => setCompletenessFilter(e.target.value)}
                      aria-label="Filter kelengkapan data"
                      className="px-3 py-2 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                    >
                      <option value="ALL">Semua Kelengkapan</option>
                      <option value="INCOMPLETE">Hanya Data Belum Lengkap</option>
                      <option value="COMPLETE">Sudah Lengkap</option>
                      <option value="MISSING_NIK">NIK Kosong</option>
                      <option value="MISSING_TTL">Tempat / Tgl Lahir Kosong</option>
                      <option value="MISSING_CONTACT">Email / No. HP Kosong</option>
                      <option value="MISSING_ALAMAT">Alamat Kosong</option>
                    </select>

                    <select
                      value={studentProdiFilter}
                      onChange={(e) => setStudentProdiFilter(e.target.value)}
                      aria-label="Filter program studi"
                      className="px-3 py-2 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                    >
                      <option value="ALL">Semua Program Studi</option>
                      {prodiList.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>

                    <div className="inline-flex items-center gap-1">
                      <select
                        value={studentSortBy}
                        onChange={(e) => {
                          const nextSort = e.target.value as StudentSortBy;
                          setStudentSortBy(nextSort);
                          if (nextSort === 'angkatan') {
                            setStudentSortDir('desc');
                          } else {
                            setStudentSortDir('asc');
                          }
                        }}
                        aria-label="Urutkan data mahasiswa berdasarkan"
                        className="px-3 py-2 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      >
                        <option value="default">Sortir: Terbaru</option>
                        <option value="nim">Sortir: NPM / NIM</option>
                        <option value="status_akademik">Sortir: Status</option>
                        <option value="angkatan">Sortir: Tahun Angkatan</option>
                        <option value="prodi">Sortir: Program Studi</option>
                      </select>

                      {studentSortBy !== 'default' && (
                        <button
                          type="button"
                          onClick={() =>
                            setStudentSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                          }
                          title={
                            studentSortDir === 'asc'
                              ? 'Urutan Naik (A–Z / Terkecil)'
                              : 'Urutan Turun (Z–A / Terbesar)'
                          }
                          aria-label="Balik urutan sortir mahasiswa"
                          className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-amber-950 bg-amber-100/80 border border-amber-300 rounded-md hover:bg-amber-200/80 transition-colors whitespace-nowrap shrink-0"
                        >
                          {studentSortDir === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                          )}
                          <span>{studentSortDir === 'asc' ? 'A–Z' : 'Z–A'}</span>
                        </button>
                      )}
                    </div>

                    <div className="relative w-56">
                      <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="Cari NIM atau nama..."
                        className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>
                  </div>
                </div>

                {loadingStudents ? (
                  <div className="p-6 space-y-2">
                    <div className="h-9 bg-amber-100/60 rounded animate-pulse" />
                    <div className="h-9 bg-amber-100/60 rounded animate-pulse" />
                  </div>
                ) : students.length === 0 ? (
                  <div className="p-10 text-center text-xs text-stone-500">
                    Tidak ada data mahasiswa yang cocok dengan filter atau pencarian Anda.
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-amber-200 bg-amber-100/70 text-xs font-semibold text-amber-950">
                            <th className="py-3 px-4">
                              <button
                                type="button"
                                onClick={() => handleStudentColumnSort('nim')}
                                className="inline-flex items-center gap-1 hover:text-orange-700 transition-colors"
                              >
                                <span>NPM / NIM</span>
                                {studentSortBy === 'nim' ? (
                                  studentSortDir === 'asc' ? (
                                    <ArrowUp className="w-3 h-3 text-orange-700" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-orange-700" />
                                  )
                                ) : (
                                  <ArrowDownUp className="w-3 h-3 text-amber-700/60" />
                                )}
                              </button>
                            </th>
                            <th className="py-3 px-4">Nama Lengkap</th>
                            <th className="py-3 px-4">
                              <button
                                type="button"
                                onClick={() => handleStudentColumnSort('prodi')}
                                className="inline-flex items-center gap-1 hover:text-orange-700 transition-colors"
                              >
                                <span>Program Studi</span>
                                {studentSortBy === 'prodi' ? (
                                  studentSortDir === 'asc' ? (
                                    <ArrowUp className="w-3 h-3 text-orange-700" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-orange-700" />
                                  )
                                ) : (
                                  <ArrowDownUp className="w-3 h-3 text-amber-700/60" />
                                )}
                              </button>
                            </th>
                            <th className="py-3 px-4 text-center">
                              <button
                                type="button"
                                onClick={() => handleStudentColumnSort('angkatan')}
                                className="inline-flex items-center gap-1 hover:text-orange-700 transition-colors"
                              >
                                <span>Angkatan</span>
                                {studentSortBy === 'angkatan' ? (
                                  studentSortDir === 'asc' ? (
                                    <ArrowUp className="w-3 h-3 text-orange-700" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-orange-700" />
                                  )
                                ) : (
                                  <ArrowDownUp className="w-3 h-3 text-amber-700/60" />
                                )}
                              </button>
                            </th>
                            <th className="py-3 px-4 text-right">Smt / IPK</th>
                            <th className="py-3 px-4">Kelengkapan Data</th>
                            <th className="py-3 px-4">
                              <button
                                type="button"
                                onClick={() => handleStudentColumnSort('status_akademik')}
                                className="inline-flex items-center gap-1 hover:text-orange-700 transition-colors"
                              >
                                <span>Status</span>
                                {studentSortBy === 'status_akademik' ? (
                                  studentSortDir === 'asc' ? (
                                    <ArrowUp className="w-3 h-3 text-orange-700" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-orange-700" />
                                  )
                                ) : (
                                  <ArrowDownUp className="w-3 h-3 text-amber-700/60" />
                                )}
                              </button>
                            </th>
                            <th className="py-3 px-4 text-right">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100 text-xs">
                          {students
                            .slice((studentPage - 1) * 50, studentPage * 50)
                            .map((st) => {
                              const missing = getMissingStudentFields(st);
                              return (
                                <tr key={st.nim} className="hover:bg-amber-50/60">
                                  <td className="py-2.5 px-4 font-mono font-medium text-stone-900 whitespace-nowrap">
                                    {st.nim}
                                  </td>
                                  <td className="py-2.5 px-4 font-semibold text-stone-900">
                                    {st.nama}
                                  </td>
                                  <td className="py-2.5 px-4 text-stone-700">{st.prodi}</td>
                                  <td className="py-2.5 px-4 text-center font-mono tabular-nums text-stone-700 whitespace-nowrap">
                                    {st.angkatan || '-'}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-stone-700 whitespace-nowrap">
                                    Smt {st.semester} · {st.ipk || '0.00'}
                                  </td>
                                  <td className="py-2.5 px-4">
                                    {missing.length === 0 ? (
                                      <span className="text-emerald-700 font-medium">
                                        Lengkap
                                      </span>
                                    ) : (
                                      <span className="text-orange-700">
                                        Kosong: {missing.map((m) => m.label).join(', ')}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-4 text-stone-700 font-medium whitespace-nowrap">
                                    {st.status_akademik}
                                  </td>
                                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                    {confirmDeleteNim === st.nim ? (
                                      <span className="inline-flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteStudent(st.nim)}
                                          className="px-2 py-1 text-[11px] font-semibold text-white bg-rose-700 rounded hover:bg-rose-800"
                                        >
                                          Hapus
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmDeleteNim(null)}
                                          className="px-2 py-1 text-[11px] font-medium text-stone-600 border border-amber-300 rounded"
                                        >
                                          Batal
                                        </button>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => openEditStudentModal(st)}
                                          className={`px-2.5 py-1 text-[11px] font-semibold rounded border transition-colors ${
                                            missing.length > 0
                                              ? 'text-amber-950 bg-amber-300 border-amber-400 hover:bg-amber-400'
                                              : 'text-stone-700 bg-white border-amber-300 hover:bg-amber-50'
                                          }`}
                                        >
                                          {missing.length > 0 ? 'Lengkapi' : 'Edit'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmDeleteNim(st.nim)}
                                          className="p-1.5 text-stone-400 hover:text-rose-700"
                                          aria-label={`Hapus ${st.nama}`}
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>

                    {students.length > 50 && (
                      <div className="px-4 py-3 border-t border-amber-200 bg-amber-50/70 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <span className="text-stone-600 tabular-nums">
                          Menampilkan {(studentPage - 1) * 50 + 1}–
                          {Math.min(studentPage * 50, students.length)} dari {students.length}{' '}
                          mahasiswa
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={studentPage <= 1}
                            onClick={() => setStudentPage((p) => Math.max(1, p - 1))}
                            className="px-3 py-1.5 font-medium text-stone-700 bg-white border border-amber-300 rounded hover:bg-amber-50 disabled:opacity-50"
                          >
                            Sebelumnya
                          </button>
                          <span className="font-mono text-stone-700 tabular-nums">
                            Hal {studentPage} / {Math.ceil(students.length / 50)}
                          </span>
                          <button
                            type="button"
                            disabled={studentPage >= Math.ceil(students.length / 50)}
                            onClick={() =>
                              setStudentPage((p) =>
                                Math.min(Math.ceil(students.length / 50), p + 1)
                              )
                            }
                            className="px-3 py-1.5 font-medium text-stone-700 bg-white border border-amber-300 rounded hover:bg-amber-50 disabled:opacity-50"
                          >
                            Berikutnya
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* VIEW 3: PENGATURAN FORMULIR LAYANAN SURAT & PEJABAT DEKAN */}
          {tab === 'forms' && (
            <div className="space-y-6">
              {/* Bagian A: Pejabat Penandatangan (Dekan) & Kop Surat Resmi */}
              <form
                onSubmit={handleSaveTemplateSettings}
                className="bg-white border border-amber-200 rounded-lg overflow-hidden"
              >
                <div className="px-6 py-5 border-b border-amber-200 bg-amber-50/70">
                  <h2 className="text-base font-bold text-stone-950">
                    01. Pengaturan Pejabat Dekan & Kop Surat Resmi
                  </h2>
                  <p className="text-xs text-stone-600 mt-1">
                    Perubahan nama Dekan, NIDN Dekan, NIK Dekan, jabatan, dan kop surat akan
                    digunakan sebagai acuan resmi pada seluruh surat yang diterbitkan.
                  </p>
                </div>

                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Nama Dekan / Pejabat Penandatangan *
                      </label>
                      <input
                        required
                        type="text"
                        value={settingsDraft.signatory_name}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({ ...p, signatory_name: e.target.value }))
                        }
                        placeholder="Dewi Qomariah Imelda, SE., MM.Ak"
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        NIDN Dekan *
                      </label>
                      <input
                        required
                        type="text"
                        value={settingsDraft.signatory_nidn}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({ ...p, signatory_nidn: e.target.value }))
                        }
                        placeholder="11.050573.02"
                        className="w-full px-3.5 py-2 text-sm font-mono border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        NIK Dekan *
                      </label>
                      <input
                        required
                        type="text"
                        value={settingsDraft.signatory_nik}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({ ...p, signatory_nik: e.target.value }))
                        }
                        placeholder="1973.2009.01.08"
                        className="w-full px-3.5 py-2 text-sm font-mono border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Jabatan Lengkap Penandatangan *
                      </label>
                      <input
                        required
                        type="text"
                        value={settingsDraft.signatory_title}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({ ...p, signatory_title: e.target.value }))
                        }
                        placeholder="Dekan Fakultas Ekonomi Universitas Kaltara"
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Judul Tanda Tangan (Bagian Bawah)
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.signatory_role_heading}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({
                            ...p,
                            signatory_role_heading: e.target.value,
                          }))
                        }
                        placeholder="DEKAN,"
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Kota Terbit Surat
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.letter_city}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({ ...p, letter_city: e.target.value }))
                        }
                        placeholder="Tanjung Selor"
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Kode Lembaga Nomor Surat
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.number_middle_code}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({ ...p, number_middle_code: e.target.value }))
                        }
                        placeholder="FE.UNIKALTAR/YAPETAS"
                        className="w-full px-3.5 py-2 text-sm font-mono border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                      <p className="text-[11px] text-stone-500 mt-1 font-mono">
                        Format otomatis: [Urutan]/{settingsDraft.number_middle_code || 'FE.UNIKALTAR/YAPETAS'}/{getRomanMonth()}/{new Date().getFullYear()}
                      </p>
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Nama Yayasan (Kop Baris 1)
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.institution_foundation}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({
                            ...p,
                            institution_foundation: e.target.value,
                          }))
                        }
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Nama Universitas (Kop Baris 2)
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.institution_university}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({
                            ...p,
                            institution_university: e.target.value,
                          }))
                        }
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Nama Fakultas (Kop Baris 3)
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.institution_faculty}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({
                            ...p,
                            institution_faculty: e.target.value,
                          }))
                        }
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block font-semibold text-stone-800 mb-1">
                        Alamat & Kontak Kop Surat
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.institution_address}
                        onChange={(e) =>
                          setSettingsDraft((p) => ({
                            ...p,
                            institution_address: e.target.value,
                          }))
                        }
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>
                  </div>

                  {/* Pengaturan Tanda Tangan Cetak PDF Surat Aktif Kuliah */}
                  <div className="p-4 border border-amber-200 rounded-md bg-amber-50/50 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <PenTool className="w-4 h-4 text-orange-700" aria-hidden="true" />
                          <h3 className="text-xs font-bold text-stone-900">
                            Tanda Tangan Dekan untuk Cetak PDF Surat Aktif Kuliah
                          </h3>
                        </div>
                        <p className="text-xs text-stone-600 mt-0.5">
                          Aktifkan agar gambar tanda tangan dapat disisipkan secara otomatis saat
                          mencetak PDF Surat Aktif Kuliah (latar belakang dibersihkan otomatis).
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          ref={staffSigInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleUploadStaffSignature}
                          className="sr-only"
                        />
                        <button
                          type="button"
                          disabled={uploadingSignature}
                          onClick={() => staffSigInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 disabled:opacity-60"
                        >
                          {uploadingSignature ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5 text-orange-600" />
                          )}
                          <span>Unggah File Baru</span>
                        </button>

                        {settingsDraft.aktif_kuliah_signature_url !== DEFAULT_DEAN_SIGNATURE_URL && (
                          <button
                            type="button"
                            onClick={() =>
                              setSettingsDraft((p) => ({
                                ...p,
                                aktif_kuliah_signature_url: DEFAULT_DEAN_SIGNATURE_URL,
                                aktif_kuliah_signature_enabled: true,
                              }))
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reset Tanda Tangan Bawaan</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-2 border-t border-amber-200/80">
                      <div className="w-48 h-20 bg-white border border-amber-200 rounded flex items-center justify-center p-2 shrink-0">
                        <img
                          src={signaturePreviewUrl}
                          alt="Pratinjau tanda tangan Dekan"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>

                      <div className="space-y-2 text-xs">
                        <label className="flex items-start gap-2.5 text-stone-800 font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settingsDraft.aktif_kuliah_signature_enabled}
                            onChange={(e) =>
                              setSettingsDraft((p) => ({
                                ...p,
                                aktif_kuliah_signature_enabled: e.target.checked,
                              }))
                            }
                            className="mt-0.5 rounded border-amber-300 text-orange-600 focus:ring-orange-600"
                          />
                          <span>
                            Sisipkan tanda tangan secara bawaan pada berkas cetak PDF Surat Aktif
                            Kuliah
                          </span>
                        </label>
                        <p className="text-[11px] text-stone-500">
                          Pengguna tetap dapat mencentang/menonaktifkan penyisipan tanda tangan
                          langsung di jendela pratinjau cetak PDF.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Pengaturan Stempel Dekan Cetak PDF Surat Aktif Kuliah */}
                  <div className="p-4 border border-amber-200 rounded-md bg-amber-50/50 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Stamp className="w-4 h-4 text-orange-700" aria-hidden="true" />
                          <h3 className="text-xs font-bold text-stone-900">
                            Stempel Dekan untuk Cetak PDF Surat Aktif Kuliah
                          </h3>
                        </div>
                        <p className="text-xs text-stone-600 mt-0.5">
                          Aktifkan agar stempel Dekan Fakultas Ekonomi dapat disisipkan secara
                          otomatis saat mencetak PDF Surat Aktif Kuliah.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          ref={staffStampInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleUploadStaffStamp}
                          className="sr-only"
                        />
                        <button
                          type="button"
                          disabled={uploadingStamp}
                          onClick={() => staffStampInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 disabled:opacity-60"
                        >
                          {uploadingStamp ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5 text-orange-600" />
                          )}
                          <span>Unggah Stempel Baru</span>
                        </button>

                        {settingsDraft.aktif_kuliah_stamp_url !== DEFAULT_DEAN_STAMP_URL && (
                          <button
                            type="button"
                            onClick={() =>
                              setSettingsDraft((p) => ({
                                ...p,
                                aktif_kuliah_stamp_url: DEFAULT_DEAN_STAMP_URL,
                                aktif_kuliah_stamp_enabled: true,
                              }))
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reset Stempel Bawaan</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-2 border-t border-amber-200/80">
                      <div className="w-48 h-24 bg-white border border-amber-200 rounded flex items-center justify-center p-2 shrink-0">
                        <img
                          src={stampPreviewUrl}
                          alt="Pratinjau stempel Dekan"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>

                      <div className="space-y-2 text-xs">
                        <label className="flex items-start gap-2.5 text-stone-800 font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settingsDraft.aktif_kuliah_stamp_enabled}
                            onChange={(e) =>
                              setSettingsDraft((p) => ({
                                ...p,
                                aktif_kuliah_stamp_enabled: e.target.checked,
                              }))
                            }
                            className="mt-0.5 rounded border-amber-300 text-orange-600 focus:ring-orange-600"
                          />
                          <span>
                            Sisipkan stempel Dekan secara bawaan pada berkas cetak PDF Surat Aktif
                            Kuliah
                          </span>
                        </label>
                        <p className="text-[11px] text-stone-500">
                          Stempel akan diposisikan menimpa sisi kiri tanda tangan Dekan secara
                          proporsional, dan tetap dapat dicentang/dinonaktifkan sebelum mencetak
                          PDF.
                        </p>
                      </div>
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 text-xs text-stone-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyToExistingLetters}
                      onChange={(e) => setApplyToExistingLetters(e.target.checked)}
                      className="mt-0.5 rounded border-amber-300 text-orange-600 focus:ring-orange-600"
                    />
                    <span>
                      Terapkan juga perubahan Nama, NIDN, NIK, dan Jabatan Dekan ke seluruh surat
                      yang sudah diajukan maupun yang sudah terbit.
                    </span>
                  </label>

                  {settingsFeedback && (
                    <div
                      role="status"
                      className={`p-3.5 text-xs rounded-md border ${
                        settingsFeedback.type === 'ok'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                    >
                      {settingsFeedback.text}
                    </div>
                  )}

                  <div className="flex justify-end pt-2 border-t border-amber-200">
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
                    >
                      {savingSettings ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      <span>Simpan Pengaturan Dekan & Kop Surat</span>
                    </button>
                  </div>
                </div>
              </form>

              {/* Bagian B: Editor Formulir per Jenis Layanan Surat */}
              <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
                <div className="px-6 py-5 border-b border-amber-200 bg-amber-50/70 space-y-4">
                  <div>
                    <h2 className="text-base font-bold text-stone-950">
                      02. Editor Formulir Layanan Surat Mahasiswa
                    </h2>
                    <p className="text-xs text-stone-600 mt-1">
                      Sesuaikan judul surat, kolom isian formulir, dokumen pendukung yang
                      diwajibkan, dan daftar periksa verifikasi untuk setiap jenis layanan.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 p-1 bg-amber-100/70 border border-amber-200 rounded-lg">
                    {services.map((srv) => (
                      <button
                        key={srv.id}
                        type="button"
                        onClick={() => {
                          setActiveServiceEditId(srv.id);
                          setServiceFeedback(null);
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          activeServiceEditId === srv.id
                            ? 'bg-orange-600 text-white shadow-sm'
                            : 'text-stone-700 hover:text-orange-800'
                        }`}
                      >
                        {srv.shortTitle}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleSaveServiceForm} className="p-6 space-y-8">
                  {/* Metadata Layanan */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Nama Layanan Surat *
                      </label>
                      <input
                        required
                        type="text"
                        value={serviceDraft.title}
                        onChange={(e) =>
                          setServiceDraft((p) => ({ ...p, title: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Judul Resmi pada Surat (Subjek Kop) *
                      </label>
                      <input
                        required
                        type="text"
                        value={serviceDraft.letterSubject}
                        onChange={(e) =>
                          setServiceDraft((p) => ({ ...p, letterSubject: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm font-semibold border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-800 mb-1">
                        Judul Singkat
                      </label>
                      <input
                        type="text"
                        value={serviceDraft.shortTitle}
                        onChange={(e) =>
                          setServiceDraft((p) => ({ ...p, shortTitle: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-stone-800 mb-1">Kategori</label>
                        <input
                          type="text"
                          value={serviceDraft.category}
                          onChange={(e) =>
                            setServiceDraft((p) => ({ ...p, category: e.target.value }))
                          }
                          className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-stone-800 mb-1">
                          Estimasi Waktu
                        </label>
                        <input
                          type="text"
                          value={serviceDraft.estimatedDays}
                          onChange={(e) =>
                            setServiceDraft((p) => ({ ...p, estimatedDays: e.target.value }))
                          }
                          className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                        />
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block font-semibold text-stone-800 mb-1">
                        Deskripsi Layanan
                      </label>
                      <textarea
                        rows={2}
                        value={serviceDraft.description}
                        onChange={(e) =>
                          setServiceDraft((p) => ({ ...p, description: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>
                  </div>

                  {/* Daftar Kolom Isian Formulir */}
                  <div className="space-y-3 pt-4 border-t border-amber-200">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-xs font-bold text-stone-900">
                          Kolom Isian Formulir Mahasiswa ({(serviceDraft.formFields || []).length})
                        </h3>
                        <p className="text-xs text-stone-500 mt-0.5">
                          Ubah label, tipe input, contoh isian, atau tambah kolom khusus baru.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const idx = (serviceDraft.formFields || []).length + 1;
                          const newField: FormFieldDef = {
                            name: `kolom_${Date.now().toString().slice(-4)}_${idx}`,
                            label: `Kolom Tambahan ${idx}`,
                            type: 'text',
                            placeholder: 'Masukkan keterangan...',
                            required: false,
                          };
                          setServiceDraft((p) => ({
                            ...p,
                            formFields: [...(p.formFields || []), newField],
                          }));
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5 text-orange-600" />
                        <span>Tambah Kolom</span>
                      </button>
                    </div>

                    <div className="divide-y divide-amber-200 border border-amber-200 rounded-md">
                      {(serviceDraft.formFields || []).map((field, idx) => (
                        <div key={`${field.name}-${idx}`} className="p-4 bg-white space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] font-mono text-stone-500">
                                #{idx + 1} · key: {field.name}
                                {field.autoFillFrom ? ` · auto: ${field.autoFillFrom}` : ''}
                              </span>
                              {field.type === 'select' && field.locked && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-amber-950 bg-amber-200/80 border border-amber-300 rounded">
                                  <Lock className="w-3 h-3" aria-hidden="true" />
                                  <span>Dikunci untuk mahasiswa</span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => {
                                  if (idx === 0) return;
                                  setServiceDraft((p) => {
                                    const next = [...(p.formFields || [])];
                                    const [moved] = next.splice(idx, 1);
                                    next.splice(idx - 1, 0, moved);
                                    return { ...p, formFields: next };
                                  });
                                }}
                                className="p-1 text-stone-400 hover:text-stone-900 disabled:opacity-30"
                                aria-label="Pindah ke atas"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === (serviceDraft.formFields || []).length - 1}
                                onClick={() => {
                                  if (idx === (serviceDraft.formFields || []).length - 1) return;
                                  setServiceDraft((p) => {
                                    const next = [...(p.formFields || [])];
                                    const [moved] = next.splice(idx, 1);
                                    next.splice(idx + 1, 0, moved);
                                    return { ...p, formFields: next };
                                  });
                                }}
                                className="p-1 text-stone-400 hover:text-stone-900 disabled:opacity-30"
                                aria-label="Pindah ke bawah"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={(serviceDraft.formFields || []).length <= 1}
                                onClick={() => {
                                  setServiceDraft((p) => ({
                                    ...p,
                                    formFields: (p.formFields || []).filter((_, i) => i !== idx),
                                  }));
                                }}
                                className="p-1 text-stone-400 hover:text-rose-700 disabled:opacity-30"
                                aria-label="Hapus kolom"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
                            <div className="md:col-span-4">
                              <label className="block font-medium text-stone-600 mb-1">
                                Label Kolom
                              </label>
                              <input
                                required
                                type="text"
                                value={field.label}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setServiceDraft((p) => ({
                                    ...p,
                                    formFields: (p.formFields || []).map((item, i) =>
                                      i === idx ? { ...item, label: val } : item
                                    ),
                                  }));
                                }}
                                className="w-full px-3 py-1.5 border border-amber-300 rounded-md"
                              />
                            </div>

                            <div className="md:col-span-3">
                              <label className="block font-medium text-stone-600 mb-1">
                                Tipe Input
                              </label>
                              <select
                                value={field.type}
                                onChange={(e) => {
                                  const nextType = e.target.value as FormFieldDef['type'];
                                  setServiceDraft((p) => ({
                                    ...p,
                                    formFields: (p.formFields || []).map((item, i) =>
                                      i === idx
                                        ? {
                                            ...item,
                                            type: nextType,
                                            options:
                                              nextType === 'select' && !item.options?.length
                                                ? ['Pilihan 1', 'Pilihan 2']
                                                : item.options,
                                            ...(nextType !== 'select'
                                              ? { locked: false, defaultValue: undefined }
                                              : {}),
                                          }
                                        : item
                                    ),
                                  }));
                                }}
                                className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-md"
                              >
                                <option value="text">Teks Singkat</option>
                                <option value="textarea">Paragraf</option>
                                <option value="date">Tanggal</option>
                                <option value="select">Pilihan Dropdown</option>
                              </select>
                            </div>

                            <div className="md:col-span-3">
                              <label className="block font-medium text-stone-600 mb-1">
                                Placeholder
                              </label>
                              <input
                                type="text"
                                value={field.placeholder}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setServiceDraft((p) => ({
                                    ...p,
                                    formFields: (p.formFields || []).map((item, i) =>
                                      i === idx ? { ...item, placeholder: val } : item
                                    ),
                                  }));
                                }}
                                className="w-full px-3 py-1.5 border border-amber-300 rounded-md"
                              />
                            </div>

                            <div className="md:col-span-2 flex items-end pb-1.5">
                              <label className="inline-flex items-center gap-2 text-xs text-stone-800 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={field.required}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setServiceDraft((p) => ({
                                      ...p,
                                      formFields: (p.formFields || []).map((item, i) =>
                                        i === idx ? { ...item, required: checked } : item
                                      ),
                                    }));
                                  }}
                                  className="rounded border-amber-300 text-orange-600 focus:ring-orange-600"
                                />
                                <span>Wajib diisi</span>
                              </label>
                            </div>

                            {field.type === 'select' && (
                              <div className="md:col-span-12 space-y-3">
                                <div>
                                  <label className="block font-medium text-stone-600 mb-1">
                                    Daftar Pilihan (pisahkan dengan koma)
                                  </label>
                                  <input
                                    type="text"
                                    value={(field.options || []).join(', ')}
                                    onChange={(e) => {
                                      const opts = e.target.value
                                        .split(',')
                                        .map((s) => s.trim())
                                        .filter(Boolean);
                                      setServiceDraft((p) => ({
                                        ...p,
                                        formFields: (p.formFields || []).map((item, i) => {
                                          if (i !== idx) return item;
                                          const currentDefault = item.defaultValue || '';
                                          const keepDefault =
                                            currentDefault && opts.includes(currentDefault)
                                              ? currentDefault
                                              : item.locked && !item.autoFillFrom && opts.length > 0
                                                ? opts[0]
                                                : '';
                                          return {
                                            ...item,
                                            options: opts,
                                            defaultValue: keepDefault || undefined,
                                          };
                                        }),
                                      }));
                                    }}
                                    placeholder="Contoh: Laki-laki, Perempuan"
                                    className="w-full px-3 py-1.5 border border-amber-300 rounded-md"
                                  />
                                </div>

                                <div className="p-3 rounded-md bg-amber-50/70 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <label className="inline-flex items-center gap-2 text-xs font-medium text-stone-800 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(field.locked)}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setServiceDraft((p) => ({
                                          ...p,
                                          formFields: (p.formFields || []).map((item, i) => {
                                            if (i !== idx) return item;
                                            const nextDefault = checked
                                              ? item.defaultValue ||
                                                (!item.autoFillFrom && item.options?.length
                                                  ? item.options[0]
                                                  : undefined)
                                              : undefined;
                                            return {
                                              ...item,
                                              locked: checked,
                                              defaultValue: nextDefault,
                                            };
                                          }),
                                        }));
                                      }}
                                      className="rounded border-amber-400 text-orange-600 focus:ring-orange-600"
                                    />
                                    <Lock
                                      className="w-3.5 h-3.5 text-amber-800 shrink-0"
                                      aria-hidden="true"
                                    />
                                    <span>
                                      Kunci isian (mahasiswa tidak dapat mengubah pilihan dropdown)
                                    </span>
                                  </label>

                                  {field.locked && (
                                    <div className="flex items-center gap-2 shrink-0">
                                      <label className="text-[11px] font-medium text-stone-600 whitespace-nowrap">
                                        Nilai dikunci ke:
                                      </label>
                                      <select
                                        value={field.defaultValue || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setServiceDraft((p) => ({
                                            ...p,
                                            formFields: (p.formFields || []).map((item, i) =>
                                              i === idx
                                                ? { ...item, defaultValue: val || undefined }
                                                : item
                                            ),
                                          }));
                                        }}
                                        className="px-2.5 py-1 text-xs bg-white border border-amber-300 rounded-md text-stone-900"
                                      >
                                        {field.autoFillFrom ? (
                                          <option value="">
                                            Otomatis dari data mahasiswa ({field.autoFillFrom})
                                          </option>
                                        ) : (
                                          <option value="">
                                            Pilihan pertama ({field.options?.[0] || '-'})
                                          </option>
                                        )}
                                        {(field.options || []).map((opt) => (
                                          <option key={opt} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Dokumen Pendukung */}
                  <div className="space-y-3 pt-4 border-t border-amber-200">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-xs font-bold text-stone-900">
                          Dokumen Pendukung yang Diminta ({(serviceDraft.requiredDocuments || []).length})
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const idx = (serviceDraft.requiredDocuments || []).length + 1;
                          setServiceDraft((p) => ({
                            ...p,
                            requiredDocuments: [
                              ...(p.requiredDocuments || []),
                              {
                                id: `dok_${Date.now().toString().slice(-4)}_${idx}`,
                                label: `Dokumen Pendukung ${idx}`,
                                description: 'Format PDF, JPG, atau PNG yang terbaca jelas.',
                                required: false,
                              },
                            ],
                          }));
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5 text-orange-600" />
                        <span>Tambah Dokumen</span>
                      </button>
                    </div>

                    <div className="divide-y divide-amber-200 border border-amber-200 rounded-md">
                      {(serviceDraft.requiredDocuments || []).length === 0 ? (
                        <p className="p-3.5 text-xs text-stone-500">
                          Tidak ada unggahan dokumen pendukung untuk layanan ini.
                        </p>
                      ) : (
                        (serviceDraft.requiredDocuments || []).map((doc, idx) => (
                          <div
                            key={`${doc.id}-${idx}`}
                            className="p-3.5 grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs"
                          >
                            <div className="md:col-span-5">
                              <label className="block font-medium text-stone-600 mb-1">
                                Nama Dokumen
                              </label>
                              <input
                                required
                                type="text"
                                value={doc.label}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setServiceDraft((p) => ({
                                    ...p,
                                    requiredDocuments: (p.requiredDocuments || []).map((d, i) =>
                                      i === idx ? { ...d, label: val } : d
                                    ),
                                  }));
                                }}
                                className="w-full px-3 py-1.5 border border-amber-300 rounded-md"
                              />
                            </div>
                            <div className="md:col-span-5">
                              <label className="block font-medium text-stone-600 mb-1">
                                Keterangan Singkat
                              </label>
                              <input
                                type="text"
                                value={doc.description}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setServiceDraft((p) => ({
                                    ...p,
                                    requiredDocuments: (p.requiredDocuments || []).map((d, i) =>
                                      i === idx ? { ...d, description: val } : d
                                    ),
                                  }));
                                }}
                                className="w-full px-3 py-1.5 border border-amber-300 rounded-md"
                              />
                            </div>
                            <div className="md:col-span-2 flex items-center justify-between gap-2 pb-1.5">
                              <label className="inline-flex items-center gap-1.5 text-xs text-stone-800 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={doc.required}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setServiceDraft((p) => ({
                                      ...p,
                                      requiredDocuments: (p.requiredDocuments || []).map((d, i) =>
                                        i === idx ? { ...d, required: checked } : d
                                      ),
                                    }));
                                  }}
                                  className="rounded border-amber-300 text-orange-600 focus:ring-orange-600"
                                />
                                <span>Wajib</span>
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  setServiceDraft((p) => ({
                                    ...p,
                                    requiredDocuments: (p.requiredDocuments || []).filter(
                                      (_, i) => i !== idx
                                    ),
                                  }));
                                }}
                                className="p-1 text-stone-400 hover:text-rose-700"
                                aria-label="Hapus dokumen"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Checklist Verifikasi */}
                  <div className="space-y-3 pt-4 border-t border-amber-200">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-xs font-bold text-stone-900">
                        Poin Pemeriksaan Staf ({(serviceDraft.defaultChecklist || []).length})
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          setServiceDraft((p) => ({
                            ...p,
                            defaultChecklist: [...(p.defaultChecklist || []), 'Poin verifikasi baru'],
                          }))
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5 text-orange-600" />
                        <span>Tambah Poin</span>
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(serviceDraft.defaultChecklist || []).map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item}
                            onChange={(e) => {
                              const val = e.target.value;
                              setServiceDraft((p) => ({
                                ...p,
                                defaultChecklist: (p.defaultChecklist || []).map((c, i) =>
                                  i === idx ? val : c
                                ),
                              }));
                            }}
                            className="flex-1 px-3 py-1.5 text-xs border border-amber-300 rounded-md"
                          />
                          <button
                            type="button"
                            disabled={(serviceDraft.defaultChecklist || []).length <= 1}
                            onClick={() =>
                              setServiceDraft((p) => ({
                                ...p,
                                defaultChecklist: (p.defaultChecklist || []).filter(
                                  (_, i) => i !== idx
                                ),
                              }))
                            }
                            className="p-1.5 text-stone-400 hover:text-rose-700 disabled:opacity-30"
                            aria-label="Hapus poin periksa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {serviceFeedback && (
                    <div
                      role="status"
                      className={`p-3.5 text-xs rounded-md border ${
                        serviceFeedback.type === 'ok'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                    >
                      {serviceFeedback.text}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-amber-200">
                    <div>
                      {confirmResetService ? (
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={savingServiceForm}
                            onClick={handleResetServiceForm}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-700 rounded-md hover:bg-rose-800"
                          >
                            Ya, Kembalikan Bawaan
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmResetService(false)}
                            className="px-3 py-1.5 text-xs font-medium text-stone-700 border border-amber-300 rounded-md"
                          >
                            Batal
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmResetService(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reset ke Bawaan</span>
                        </button>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={savingServiceForm}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
                    >
                      {savingServiceForm ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      <span>Simpan Formulir Layanan</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 4: CADANGKAN & PULIHKAN SELURUH DATA DAN PENGATURAN */}
          {tab === 'backup' && (
            <div className="space-y-6">
              {/* Ringkasan Kondisi Saat Ini */}
              <div className="bg-white border border-amber-200 rounded-lg p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-stone-950">
                      Cadangan & Pemulihan Lengkap (Data + Pengaturan)
                    </h2>
                    <p className="text-xs text-stone-600 mt-1">
                      Simpan seluruh basis data, berkas pengajuan surat, lampiran dokumen, serta
                      seluruh pengaturan sistem ke hardisk lokal dalam satu file terpadu.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={loadingBackupSummary}
                    onClick={loadBackupSummary}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 shrink-0"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${loadingBackupSummary ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>Segarkan Ringkasan</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                  <div className="p-3.5 border border-amber-200 rounded-md bg-amber-50/50">
                    <p className="text-[11px] font-medium text-stone-500">Data Mahasiswa</p>
                    <p className="text-lg font-bold text-stone-950 tabular-nums mt-0.5">
                      {currentBackupSummary
                        ? currentBackupSummary.counts.students.toLocaleString('id-ID')
                        : '-'}
                    </p>
                  </div>
                  <div className="p-3.5 border border-amber-200 rounded-md bg-amber-50/50">
                    <p className="text-[11px] font-medium text-stone-500">Pengajuan Surat</p>
                    <p className="text-lg font-bold text-stone-950 tabular-nums mt-0.5">
                      {currentBackupSummary
                        ? currentBackupSummary.counts.letterRequests.toLocaleString('id-ID')
                        : '-'}
                    </p>
                  </div>
                  <div className="p-3.5 border border-amber-200 rounded-md bg-amber-50/50">
                    <p className="text-[11px] font-medium text-stone-500">
                      Berkas Lampiran & Impor
                    </p>
                    <p className="text-lg font-bold text-stone-950 tabular-nums mt-0.5">
                      {currentBackupSummary
                        ? `${currentBackupSummary.counts.uploadFiles} berkas · ${currentBackupSummary.counts.importLogs} log`
                        : '-'}
                    </p>
                  </div>
                  <div className="p-3.5 border border-amber-200 rounded-md bg-amber-50/50">
                    <p className="text-[11px] font-medium text-stone-500">
                      Pengaturan & Aset Dekan
                    </p>
                    <p className="text-lg font-bold text-stone-950 tabular-nums mt-0.5">
                      {currentBackupSummary
                        ? `${currentBackupSummary.counts.settings} entri · ${currentBackupSummary.counts.signatureFiles} file`
                        : '-'}
                    </p>
                  </div>
                </div>
              </div>

              {backupFeedback && (
                <div
                  role="status"
                  className={`p-4 text-xs rounded-lg border flex items-start gap-2.5 ${
                    backupFeedback.type === 'ok'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  {backupFeedback.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  )}
                  <span className="leading-relaxed">{backupFeedback.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* Panel Simpan ke Hardisk Lokal */}
                <section className="bg-white border border-amber-200 rounded-lg p-6 space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-md bg-orange-600 text-white shrink-0">
                      <Download className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-stone-950">
                        1. Simpan Seluruh Data & Pengaturan ke Hardisk Lokal
                      </h3>
                      <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                        Mengunduh arsip cadangan terkompresi (format{' '}
                        <span className="font-mono font-semibold text-stone-800">
                          .fe-backup.gz
                        </span>
                        ) langsung ke folder Unduhan komputer Anda.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-amber-50/50 border border-amber-200 rounded-md space-y-2 text-xs text-stone-700">
                    <p className="font-semibold text-stone-900">
                      Cakupan isi file cadangan:
                    </p>
                    <ul className="space-y-1.5 text-stone-600">
                      <li className="flex items-start gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                        <span>
                          Seluruh data mahasiswa (NPM, NIK, prodi, angkatan, biodata lengkap) &
                          riwayat impor Excel.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                        <span>
                          Seluruh pengajuan surat mahasiswa, nomor surat resmi, catatan verifikasi,
                          serta semua file berkas lampiran PDF/gambar.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                        <span>
                          Seluruh pengaturan sistem: kustomisasi formulir layanan surat, data
                          pejabat Dekan (Nama, NIDN, NIK), kop surat, file tanda tangan & stempel
                          Dekan, serta kredensial akses staf.
                        </span>
                      </li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    disabled={exportingBackup}
                    onClick={handleDownloadBackup}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 transition-colors disabled:opacity-60"
                  >
                    {exportingBackup ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>
                      {exportingBackup
                        ? 'Menyiapkan File Cadangan...'
                        : 'Unduh Seluruh Data & Pengaturan ke Hardisk'}
                    </span>
                  </button>
                </section>

                {/* Panel Pulihkan dari Hardisk Lokal */}
                <section className="bg-white border border-amber-200 rounded-lg p-6 space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-md bg-amber-400 text-amber-950 shrink-0">
                      <Upload className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-stone-950">
                        2. Pulihkan Data & Pengaturan dari Hardisk Lokal
                      </h3>
                      <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                        Unggah kembali file{' '}
                        <span className="font-mono font-semibold text-stone-800">
                          .fe-backup.gz
                        </span>{' '}
                        yang pernah Anda simpan untuk mengembalikan seluruh data dan pengaturan
                        aplikasi.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 border border-dashed border-amber-300 rounded-md bg-amber-50/50 text-center space-y-3">
                    <input
                      ref={backupFileInputRef}
                      type="file"
                      accept=".gz,.fe-backup.gz,.json,application/gzip,application/x-gzip,application/json"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        e.target.value = '';
                        handleInspectBackupFile(file);
                      }}
                      className="sr-only"
                    />
                    <p className="text-xs text-stone-600">
                      Pilih file cadangan dari komputer Anda untuk diperiksa isinya sebelum proses
                      pemulihan dijalankan.
                    </p>
                    <button
                      type="button"
                      disabled={inspectingBackup || restoringBackup}
                      onClick={() => backupFileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 transition-colors disabled:opacity-60"
                    >
                      {inspectingBackup ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>
                        {inspectingBackup ? 'Memeriksa File...' : 'Pilih File Cadangan dari Hardisk'}
                      </span>
                    </button>
                  </div>

                  {inspectedBackup && pendingRestoreFile && (
                    <div className="p-4 border border-amber-300 bg-amber-50/70 rounded-md space-y-4 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-stone-950">
                            Pratinjau File Cadangan Siap Dipulihkan
                          </p>
                          <p className="text-stone-600 mt-0.5 font-mono text-[11px]">
                            {pendingRestoreFile.name} ({formatBytes(pendingRestoreFile.size)})
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingRestoreFile(null);
                            setInspectedBackup(null);
                          }}
                          className="text-stone-500 hover:text-stone-900"
                          aria-label="Batalkan pratinjau pemulihan"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <dl className="grid grid-cols-2 gap-2 bg-white/90 border border-amber-200 rounded p-3">
                        <div>
                          <dt className="text-stone-500 text-[11px]">Tanggal Cadangan</dt>
                          <dd className="font-semibold text-stone-900">
                            {formatTanggalIndonesia(inspectedBackup.exportedAt)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-stone-500 text-[11px]">Dibuat Oleh</dt>
                          <dd className="font-semibold text-stone-900 truncate">
                            {inspectedBackup.exportedBy}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-stone-500 text-[11px]">Data Mahasiswa</dt>
                          <dd className="font-semibold text-stone-900 tabular-nums">
                            {inspectedBackup.counts.students.toLocaleString('id-ID')} data
                          </dd>
                        </div>
                        <div>
                          <dt className="text-stone-500 text-[11px]">Pengajuan Surat</dt>
                          <dd className="font-semibold text-stone-900 tabular-nums">
                            {inspectedBackup.counts.letterRequests.toLocaleString('id-ID')} pengajuan
                          </dd>
                        </div>
                        <div>
                          <dt className="text-stone-500 text-[11px]">Berkas & Impor</dt>
                          <dd className="font-semibold text-stone-900 tabular-nums">
                            {inspectedBackup.counts.uploadFiles} berkas ·{' '}
                            {inspectedBackup.counts.importLogs} log
                          </dd>
                        </div>
                        <div>
                          <dt className="text-stone-500 text-[11px]">Pengaturan & TTD/Stempel</dt>
                          <dd className="font-semibold text-stone-900 tabular-nums">
                            {inspectedBackup.counts.settings} pengaturan ·{' '}
                            {inspectedBackup.counts.signatureFiles} file
                            {typeof inspectedBackup.counts.staffAccounts === 'number'
                              ? ` · ${inspectedBackup.counts.staffAccounts} akun staf`
                              : ''}
                          </dd>
                        </div>
                      </dl>

                      <div className="flex items-start gap-2 text-amber-950 bg-amber-100/80 border border-amber-300 rounded p-3">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                        <p className="leading-relaxed">
                          Pemulihan akan mengganti seluruh data dan pengaturan yang saat ini aktif
                          dengan isi file cadangan di atas. Pastikan Anda sudah menyimpan cadangan
                          terbaru jika diperlukan.
                        </p>
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={restoringBackup}
                          onClick={() => {
                            setPendingRestoreFile(null);
                            setInspectedBackup(null);
                          }}
                          className="px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          disabled={restoringBackup}
                          onClick={handleConfirmRestoreBackup}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
                        >
                          {restoringBackup ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span>
                            {restoringBackup
                              ? 'Memulihkan Data & Pengaturan...'
                              : 'Ya, Pulihkan Seluruh Data & Pengaturan'}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          {/* VIEW 5: KELOLA AKUN STAF ADMINISTRASI */}
          {tab === 'staff' && (
            <div className="space-y-6">
              {staffAccountFeedback && (
                <div
                  role={staffAccountFeedback.type === 'err' ? 'alert' : 'status'}
                  className={`p-3.5 text-xs rounded-md border flex items-center justify-between gap-3 ${
                    staffAccountFeedback.type === 'ok'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  <span>{staffAccountFeedback.text}</span>
                  <button
                    type="button"
                    onClick={() => setStaffAccountFeedback(null)}
                    className="p-1 text-current/70 hover:text-current"
                    aria-label="Tutup pesan"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Form Tambah Staf Baru */}
                <form
                  onSubmit={handleCreateStaffAccount}
                  className="lg:col-span-5 bg-white border border-amber-200 rounded-lg overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-amber-200 bg-amber-50/70">
                    <div className="flex items-center gap-2">
                      <UserPlus className="w-4 h-4 text-orange-600 shrink-0" aria-hidden="true" />
                      <h2 className="text-sm font-bold text-stone-950">
                        Tambah Staf Administrasi Baru
                      </h2>
                    </div>
                    <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                      Tambahkan akun petugas administrasi baru agar dapat masuk ke Portal Staf
                      menggunakan username dan kata sandi masing-masing.
                    </p>
                  </div>

                  <div className="p-5 space-y-4 text-xs">
                    <div>
                      <label
                        htmlFor="new-staff-fullname"
                        className="block font-semibold text-stone-800 mb-1"
                      >
                        Nama Lengkap Staf *
                      </label>
                      <input
                        id="new-staff-fullname"
                        required
                        type="text"
                        value={newStaffFullName}
                        onChange={(e) => setNewStaffFullName(e.target.value)}
                        placeholder="Contoh: Siti Rahmawati, S.E."
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="new-staff-username"
                        className="block font-semibold text-stone-800 mb-1"
                      >
                        Username Staf (untuk Masuk) *
                      </label>
                      <input
                        id="new-staff-username"
                        required
                        type="text"
                        value={newStaffUsername}
                        onChange={(e) =>
                          setNewStaffUsername(
                            e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '')
                          )
                        }
                        placeholder="Contoh: siti.rahma"
                        autoComplete="off"
                        className="w-full px-3.5 py-2 text-sm font-mono border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                      <p className="text-[11px] text-stone-500 mt-1">
                        3–40 karakter: huruf kecil, angka, titik (.), garis bawah (_), atau (-).
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="new-staff-role"
                        className="block font-semibold text-stone-800 mb-1"
                      >
                        Jabatan / Bagian
                      </label>
                      <input
                        id="new-staff-role"
                        type="text"
                        value={newStaffRoleTitle}
                        onChange={(e) => setNewStaffRoleTitle(e.target.value)}
                        placeholder="Staf Administrasi Akademik"
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="new-staff-passcode"
                        className="block font-semibold text-stone-800 mb-1"
                      >
                        Kata Sandi (Min. 6 Karakter) *
                      </label>
                      <div className="relative">
                        <input
                          id="new-staff-passcode"
                          required
                          type={showNewStaffPasscode ? 'text' : 'password'}
                          value={newStaffPasscode}
                          onChange={(e) => setNewStaffPasscode(e.target.value)}
                          placeholder="Masukkan kata sandi staf baru"
                          autoComplete="new-password"
                          className="w-full pl-3.5 pr-10 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewStaffPasscode((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700"
                          aria-label={
                            showNewStaffPasscode ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'
                          }
                        >
                          {showNewStaffPasscode ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="new-staff-passcode-confirm"
                        className="block font-semibold text-stone-800 mb-1"
                      >
                        Konfirmasi Kata Sandi *
                      </label>
                      <input
                        id="new-staff-passcode-confirm"
                        required
                        type={showNewStaffPasscode ? 'text' : 'password'}
                        value={newStaffPasscodeConfirm}
                        onChange={(e) => setNewStaffPasscodeConfirm(e.target.value)}
                        placeholder="Ulangi kata sandi staf baru"
                        autoComplete="new-password"
                        className="w-full px-3.5 py-2 text-sm border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                      />
                    </div>
                  </div>

                  <div className="px-5 py-3.5 border-t border-amber-200 bg-amber-50/70 flex justify-end">
                    <button
                      type="submit"
                      disabled={savingNewStaff}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60 transition-colors"
                    >
                      {savingNewStaff ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>{savingNewStaff ? 'Menambahkan...' : 'Tambahkan Staf Baru'}</span>
                    </button>
                  </div>
                </form>

                {/* Daftar Akun Staf Administrasi */}
                <section className="lg:col-span-7 bg-white border border-amber-200 rounded-lg overflow-hidden">
                  <div className="px-5 py-4 border-b border-amber-200 flex flex-wrap items-center justify-between gap-3 bg-amber-50/70">
                    <div>
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-orange-600 shrink-0" aria-hidden="true" />
                        <h2 className="text-sm font-bold text-stone-950">
                          Daftar Staf Administrasi ({staffAccounts.length})
                        </h2>
                      </div>
                      <p className="text-xs text-stone-600 mt-0.5">
                        Nama petugas yang sedang masuk otomatis tercatat saat memverifikasi surat
                        atau mengimpor data Excel.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={loadStaffAccounts}
                      disabled={loadingStaffAccounts}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50 disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 text-orange-600 ${
                          loadingStaffAccounts ? 'animate-spin' : ''
                        }`}
                        aria-hidden="true"
                      />
                      <span>Muat Ulang</span>
                    </button>
                  </div>

                  {envPasscodeActive && (
                    <div className="px-5 py-2.5 bg-amber-100/70 border-b border-amber-200 text-xs text-amber-950 flex items-center gap-2">
                      <KeyRound className="w-3.5 h-3.5 text-orange-700 shrink-0" aria-hidden="true" />
                      <span>
                        Kata sandi bawaan server aktif sebagai akses darurat admin utama (username{' '}
                        <span className="font-mono font-semibold">admin</span>).
                      </span>
                    </div>
                  )}

                  {loadingStaffAccounts && staffAccounts.length === 0 ? (
                    <div className="p-6 space-y-2">
                      <div className="h-12 bg-amber-100/60 rounded animate-pulse" />
                      <div className="h-12 bg-amber-100/60 rounded animate-pulse" />
                    </div>
                  ) : staffAccounts.length === 0 ? (
                    <div className="p-8 text-center text-xs text-stone-500">
                      Belum ada akun staf tersimpan di basis data. Gunakan formulir di sebelah kiri
                      untuk menambahkan staf administrasi baru.
                    </div>
                  ) : (
                    <div className="divide-y divide-amber-100">
                      {staffAccounts.map((acc) => {
                        const isSelf = currentStaffId === acc.id;
                        return (
                          <div
                            key={acc.id}
                            className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-amber-50/50 transition-colors"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-stone-950 truncate">
                                  {acc.full_name}
                                </span>
                                {acc.is_primary && (
                                  <span className="px-2 py-0.5 text-[11px] font-semibold bg-amber-200 text-amber-950 rounded">
                                    Utama
                                  </span>
                                )}
                                {isSelf && (
                                  <span className="px-2 py-0.5 text-[11px] font-semibold bg-orange-600 text-white rounded">
                                    Sedang Masuk
                                  </span>
                                )}
                                <span
                                  className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                                    acc.is_active
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-stone-200 text-stone-700'
                                  }`}
                                >
                                  {acc.is_active ? 'Aktif' : 'Nonaktif'}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
                                <span>
                                  Username:{' '}
                                  <strong className="font-mono text-stone-900">{acc.username}</strong>
                                </span>
                                <span>· {acc.role_title}</span>
                              </div>
                              <p className="text-[11px] text-stone-500">
                                Ditambahkan oleh {acc.created_by} ·{' '}
                                {formatTanggalIndonesia(acc.created_at)}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => openEditStaffModal(acc)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded hover:bg-amber-50"
                              >
                                <Pencil className="w-3 h-3 text-orange-600" aria-hidden="true" />
                                <span>Ubah / Reset Sandi</span>
                              </button>

                              {!isSelf && (
                                <button
                                  type="button"
                                  disabled={togglingStaffId === acc.id}
                                  onClick={() => handleToggleStaffActive(acc)}
                                  className={`px-2.5 py-1.5 text-xs font-semibold rounded border transition-colors disabled:opacity-60 ${
                                    acc.is_active
                                      ? 'text-amber-950 bg-amber-100 border-amber-300 hover:bg-amber-200'
                                      : 'text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                                  }`}
                                >
                                  {togglingStaffId === acc.id
                                    ? 'Menyimpan...'
                                    : acc.is_active
                                    ? 'Nonaktifkan'
                                    : 'Aktifkan'}
                                </button>
                              )}

                              {!isSelf && !acc.is_primary && (
                                <>
                                  {confirmDeleteStaffId === acc.id ? (
                                    <span className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={deletingStaffId === acc.id}
                                        onClick={() => handleDeleteStaffAccount(acc.id)}
                                        className="px-2 py-1.5 text-xs font-semibold text-white bg-rose-700 rounded hover:bg-rose-800 disabled:opacity-60"
                                      >
                                        {deletingStaffId === acc.id ? 'Menghapus...' : 'Ya, Hapus'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteStaffId(null)}
                                        className="px-2 py-1.5 text-xs font-medium text-stone-600 bg-white border border-amber-300 rounded"
                                      >
                                        Batal
                                      </button>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteStaffId(acc.id)}
                                      className="p-1.5 text-stone-400 hover:text-rose-700"
                                      aria-label={`Hapus akun ${acc.full_name}`}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modal Ubah / Reset Sandi Akun Staf */}
      {editingStaffAccount && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Ubah Data dan Kata Sandi Staf Administrasi"
        >
          <form
            onSubmit={handleSaveEditStaffAccount}
            className="w-full max-w-md bg-white border border-amber-200 rounded-lg overflow-hidden shadow-xl my-auto"
          >
            <div className="px-5 py-4 border-b border-amber-200 flex items-center justify-between bg-amber-50/70">
              <div>
                <h3 className="text-sm font-bold text-stone-950">Ubah Akun Staf Administrasi</h3>
                <p className="text-[11px] text-stone-600 mt-0.5 font-mono">
                  Username: {editingStaffAccount.username}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingStaffAccount(null)}
                className="p-1 text-stone-500 hover:text-stone-900"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Nama Lengkap *</label>
                <input
                  required
                  type="text"
                  value={editStaffFullName}
                  onChange={(e) => setEditStaffFullName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">Jabatan / Bagian</label>
                <input
                  type="text"
                  value={editStaffRoleTitle}
                  onChange={(e) => setEditStaffRoleTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                />
              </div>

              <div className="pt-2 border-t border-amber-200 space-y-3">
                <p className="font-semibold text-stone-800">
                  Reset Kata Sandi <span className="font-normal text-stone-500">(Opsional)</span>
                </p>
                <div className="relative">
                  <input
                    type={showEditStaffPasscode ? 'text' : 'password'}
                    value={editStaffNewPasscode}
                    onChange={(e) => setEditStaffNewPasscode(e.target.value)}
                    placeholder="Kosongkan jika tidak ingin mengubah sandi"
                    autoComplete="new-password"
                    className="w-full pl-3 pr-9 py-2 text-sm border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditStaffPasscode((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700"
                    aria-label={showEditStaffPasscode ? 'Sembunyikan sandi' : 'Lihat sandi'}
                  >
                    {showEditStaffPasscode ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {editStaffNewPasscode && (
                  <input
                    type={showEditStaffPasscode ? 'text' : 'password'}
                    value={editStaffNewPasscodeConfirm}
                    onChange={(e) => setEditStaffNewPasscodeConfirm(e.target.value)}
                    placeholder="Ulangi kata sandi baru (min. 6 karakter)"
                    autoComplete="new-password"
                    className="w-full px-3 py-2 text-sm border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                  />
                )}
              </div>

              {editStaffError && (
                <p className="text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded">
                  {editStaffError}
                </p>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-amber-200 bg-amber-50/70 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingStaffAccount(null)}
                className="px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingEditStaff}
                className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
              >
                {savingEditStaff ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Tambah / Lengkapi Data Mahasiswa Manual */}
      {showAddStudent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Tambah atau Lengkapi Data Mahasiswa"
        >
          <form
            onSubmit={handleAddSingleStudent}
            className="w-full max-w-2xl bg-white border border-amber-200 rounded-lg overflow-hidden shadow-xl my-auto"
          >
            <div className="px-5 py-4 border-b border-amber-200 flex items-center justify-between bg-amber-50/70">
              <div>
                <h3 className="text-sm font-bold text-stone-950">
                  {editingExistingStudent
                    ? 'Lengkapi / Perbarui Data Mahasiswa'
                    : 'Tambah Data Mahasiswa Baru'}
                </h3>
                <p className="text-[11px] text-stone-600 mt-0.5">
                  Kolom dengan tepi kuning menandakan data masih kosong dan perlu dilengkapi.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStudent(false)}
                className="p-1 text-stone-500 hover:text-stone-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-stone-800 mb-1">NPM / NIM *</label>
                <input
                  required
                  type="text"
                  value={newStudent.nim}
                  onChange={(e) => setNewStudent((p) => ({ ...p, nim: e.target.value }))}
                  placeholder="202541012"
                  className="w-full px-3 py-2 font-mono border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  NIK (KTP){' '}
                  {!newStudent.nik.trim() && (
                    <span className="font-normal text-amber-700">(Masih kosong)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={newStudent.nik}
                  onChange={(e) => setNewStudent((p) => ({ ...p, nik: e.target.value }))}
                  placeholder="16 digit NIK"
                  className={`w-full px-3 py-2 font-mono border rounded-md focus:border-orange-600 focus:outline-none ${
                    !newStudent.nik.trim()
                      ? 'border-amber-400 bg-amber-50/50'
                      : 'border-amber-300'
                  }`}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-stone-800 mb-1">Nama Lengkap *</label>
                <input
                  required
                  type="text"
                  value={newStudent.nama}
                  onChange={(e) => setNewStudent((p) => ({ ...p, nama: e.target.value }))}
                  placeholder="Nama mahasiswa"
                  className="w-full px-3 py-2 border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Tempat Lahir{' '}
                  {!newStudent.tempat_lahir.trim() && (
                    <span className="font-normal text-amber-700">(Masih kosong)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={newStudent.tempat_lahir}
                  onChange={(e) => setNewStudent((p) => ({ ...p, tempat_lahir: e.target.value }))}
                  placeholder="Contoh: TARAKAN"
                  className={`w-full px-3 py-2 border rounded-md focus:border-orange-600 focus:outline-none ${
                    !newStudent.tempat_lahir.trim()
                      ? 'border-amber-400 bg-amber-50/50'
                      : 'border-amber-300'
                  }`}
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Tanggal Lahir{' '}
                  {!newStudent.tanggal_lahir.trim() && (
                    <span className="font-normal text-amber-700">(Masih kosong)</span>
                  )}
                </label>
                <input
                  type="date"
                  value={newStudent.tanggal_lahir}
                  onChange={(e) => setNewStudent((p) => ({ ...p, tanggal_lahir: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-md focus:border-orange-600 focus:outline-none ${
                    !newStudent.tanggal_lahir.trim()
                      ? 'border-amber-400 bg-amber-50/50'
                      : 'border-amber-300'
                  }`}
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Jenis Kelamin</label>
                <select
                  value={newStudent.jenis_kelamin}
                  onChange={(e) => setNewStudent((p) => ({ ...p, jenis_kelamin: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-md focus:border-orange-600 focus:outline-none ${
                    !newStudent.jenis_kelamin.trim()
                      ? 'border-amber-400 bg-amber-50/50'
                      : 'border-amber-300'
                  }`}
                >
                  <option value="">Pilih jenis kelamin</option>
                  <option value="Perempuan">Perempuan</option>
                  <option value="Laki-laki">Laki-laki</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Jenjang</label>
                <input
                  type="text"
                  value={newStudent.jenjang}
                  onChange={(e) => setNewStudent((p) => ({ ...p, jenjang: e.target.value }))}
                  placeholder="SARJANA (S1)"
                  className="w-full px-3 py-2 border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Program Studi *</label>
                <input
                  required
                  type="text"
                  value={newStudent.prodi}
                  onChange={(e) => setNewStudent((p) => ({ ...p, prodi: e.target.value }))}
                  placeholder="MANAJEMEN"
                  className="w-full px-3 py-2 border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Fakultas *</label>
                <input
                  required
                  type="text"
                  value={newStudent.fakultas}
                  onChange={(e) => setNewStudent((p) => ({ ...p, fakultas: e.target.value }))}
                  placeholder="Fakultas Ekonomi"
                  className="w-full px-3 py-2 border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Semester</label>
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={newStudent.semester}
                  onChange={(e) => setNewStudent((p) => ({ ...p, semester: e.target.value }))}
                  className="w-full px-3 py-2 font-mono border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">IPK</label>
                <input
                  type="text"
                  value={newStudent.ipk}
                  onChange={(e) => setNewStudent((p) => ({ ...p, ipk: e.target.value }))}
                  className="w-full px-3 py-2 font-mono border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Email{' '}
                  {!newStudent.email.trim() && (
                    <span className="font-normal text-amber-700">(Masih kosong)</span>
                  )}
                </label>
                <input
                  type="email"
                  value={newStudent.email}
                  onChange={(e) => setNewStudent((p) => ({ ...p, email: e.target.value }))}
                  placeholder="nama@email.com"
                  className={`w-full px-3 py-2 border rounded-md focus:border-orange-600 focus:outline-none ${
                    !newStudent.email.trim()
                      ? 'border-amber-400 bg-amber-50/50'
                      : 'border-amber-300'
                  }`}
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  No. HP / WhatsApp{' '}
                  {!newStudent.no_hp.trim() && (
                    <span className="font-normal text-amber-700">(Masih kosong)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={newStudent.no_hp}
                  onChange={(e) => setNewStudent((p) => ({ ...p, no_hp: e.target.value }))}
                  placeholder="08xxxxxxxxxx"
                  className={`w-full px-3 py-2 font-mono border rounded-md focus:border-orange-600 focus:outline-none ${
                    !newStudent.no_hp.trim()
                      ? 'border-amber-400 bg-amber-50/50'
                      : 'border-amber-300'
                  }`}
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Status Akademik</label>
                <select
                  value={newStudent.status_akademik}
                  onChange={(e) =>
                    setNewStudent((p) => ({ ...p, status_akademik: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-amber-300 rounded-md focus:border-orange-600 focus:outline-none"
                >
                  <option value="Aktif">Aktif</option>
                  <option value="Nonaktif">Nonaktif</option>
                  <option value="Cuti">Cuti</option>
                  <option value="Lulus">Lulus</option>
                  <option value="KELUAR">KELUAR</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-stone-800 mb-1">
                  Alamat Lengkap{' '}
                  {!newStudent.alamat.trim() && (
                    <span className="font-normal text-amber-700">(Masih kosong)</span>
                  )}
                </label>
                <textarea
                  rows={2}
                  value={newStudent.alamat}
                  onChange={(e) => setNewStudent((p) => ({ ...p, alamat: e.target.value }))}
                  placeholder="Jalan, RT/RW, Kecamatan, Kabupaten/Kota"
                  className={`w-full px-3 py-2 border rounded-md focus:border-orange-600 focus:outline-none ${
                    !newStudent.alamat.trim()
                      ? 'border-amber-400 bg-amber-50/50'
                      : 'border-amber-300'
                  }`}
                />
              </div>
              {addStudentError && (
                <p className="sm:col-span-2 text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded">
                  {addStudentError}
                </p>
              )}
            </div>
            <div className="px-5 py-3.5 border-t border-amber-200 bg-amber-50/70 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddStudent(false)}
                className="px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
              >
                Batal
              </button>
              {editingExistingStudent && (
                <button
                  type="button"
                  disabled={savingStudent}
                  onClick={() => saveStudentRecord(true)}
                  className="px-3.5 py-2 text-xs font-semibold text-stone-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 disabled:opacity-60"
                >
                  {savingStudent ? 'Menyimpan...' : 'Simpan & Lanjut Berikutnya'}
                </button>
              )}
              <button
                type="submit"
                disabled={savingStudent}
                className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60"
              >
                {savingStudent ? 'Menyimpan...' : 'Simpan Mahasiswa'}
              </button>
            </div>
          </form>
        </div>
      )}

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
        isStaff={true}
        autoDownloadPdf={autoDownloadPdf}
        onAutoDownloadDone={() => setAutoDownloadPdf(false)}
        onClose={() => {
          setOfficialLetterReq(null);
          setAutoDownloadPdf(false);
        }}
      />
      {/* Navigasi Bawah Khusus Mobile / Android */}
      <nav
        aria-label="Navigasi Cepat Android Staf"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-amber-200 px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] grid grid-cols-5 gap-0.5 shadow-lg"
      >
        <button
          type="button"
          onClick={() => setTab('requests')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md text-[10px] font-semibold transition-colors ${
            tab === 'requests' ? 'text-orange-700 bg-orange-50' : 'text-stone-600'
          }`}
        >
          <Inbox className="w-4 h-4" aria-hidden="true" />
          <span>Antrean</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('students')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md text-[10px] font-semibold transition-colors ${
            tab === 'students' ? 'text-orange-700 bg-orange-50' : 'text-stone-600'
          }`}
        >
          <Users className="w-4 h-4" aria-hidden="true" />
          <span>Mahasiswa</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('forms')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md text-[10px] font-semibold transition-colors ${
            tab === 'forms' ? 'text-orange-700 bg-orange-50' : 'text-stone-600'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          <span>Formulir</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('backup')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md text-[10px] font-semibold transition-colors ${
            tab === 'backup' ? 'text-orange-700 bg-orange-50' : 'text-stone-600'
          }`}
        >
          <HardDrive className="w-4 h-4" aria-hidden="true" />
          <span>Cadangan</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('staff')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md text-[10px] font-semibold transition-colors ${
            tab === 'staff' ? 'text-orange-700 bg-orange-50' : 'text-stone-600'
          }`}
        >
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          <span>Staf</span>
        </button>
      </nav>
    </div>
  );
}
