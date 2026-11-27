import {
  ArrowDownUp,
  ArrowRight,
  BarChart3,
  Building2,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import {
  DEFAULT_UNIVERSITY_LOGO_URL,
  type ActiveStudentStatsSummary,
  type StudentRecord,
} from '../shared/types';
import { PWAInstallButton } from './PWAInstallButton';

export type AuthSession =
  | { role: 'student'; token: string; student: StudentRecord }
  | { role: 'staff'; token: string; staffName: string };

interface LoginViewProps {
  onLoginSuccess: (session: AuthSession) => void;
}

interface StaffStatusResponse {
  configured: boolean;
  source: 'env' | 'claimed' | 'unclaimed';
  hasStaffAccounts?: boolean;
  staffCount?: number;
}

export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [roleTab, setRoleTab] = useState<'student' | 'staff'>('student');
  const [nim, setNim] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPasscode, setStaffPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);

  // First-run staff claim state (when server ADMIN_PASSCODE is not yet configured)
  const [staffStatus, setStaffStatus] = useState<StaffStatusResponse | null>(null);
  const [claimName, setClaimName] = useState('');
  const [claimUsername, setClaimUsername] = useState('admin');
  const [claimPasscode, setClaimPasscode] = useState('');
  const [claimConfirm, setClaimConfirm] = useState('');

  // Active student cohort stats
  const [cohortStats, setCohortStats] = useState<ActiveStudentStatsSummary | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [cohortFilter, setCohortFilter] = useState<'all' | 'recent'>('recent');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campusImgFailed, setCampusImgFailed] = useState(false);
  const [emblemFailed, setEmblemFailed] = useState(false);

  useEffect(() => {
    apiRequest<StaffStatusResponse>('/api/auth/staff/status')
      .then((res) => setStaffStatus(res))
      .catch(() => setStaffStatus({ configured: true, source: 'env' }));

    setStatsLoading(true);
    setStatsError(null);
    apiRequest<ActiveStudentStatsSummary>('/api/public/active-student-stats')
      .then((res) => setCohortStats(res))
      .catch(() => setStatsError('Statistik mahasiswa aktif belum dapat dimuat.'))
      .finally(() => setStatsLoading(false));
  }, []);

  const visibleCohorts = useMemo(() => {
    if (!cohortStats) return [];
    let list = [...cohortStats.cohorts];
    if (cohortFilter === 'recent') {
      list = list.slice(0, 5);
    }
    if (sortOrder === 'asc') {
      list.sort((a, b) => Number(a.angkatan) - Number(b.angkatan));
    } else {
      list.sort((a, b) => Number(b.angkatan) - Number(a.angkatan));
    }
    return list;
  }, [cohortStats, cohortFilter, sortOrder]);

  const maxCohortTotal = useMemo(() => {
    if (!cohortStats || cohortStats.cohorts.length === 0) return 1;
    return Math.max(...cohortStats.cohorts.map((c) => c.total), 1);
  }, [cohortStats]);

  async function handleStudentLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nim.trim()) {
      setError('Masukkan Nomor Induk Mahasiswa (NPM / NIM) Anda terlebih dahulu.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{
        token: string;
        role: 'student';
        student: StudentRecord;
      }>('/api/auth/student/login', {
        method: 'POST',
        body: { nim: nim.trim() },
      });
      onLoginSuccess({ role: 'student', token: res.token, student: res.student });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk sebagai mahasiswa.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStaffLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!staffPasscode.trim()) {
      setError('Masukkan kata sandi Staf Administrasi.');
      return;
    }

    setLoading(true);
    try {
      const normalizedUsername = staffUsername.trim().toLowerCase();
      const res = await apiRequest<{
        token: string;
        role: 'staff';
        staffName: string;
      }>('/api/auth/staff/login', {
        method: 'POST',
        body: {
          username: normalizedUsername || undefined,
          passcode: staffPasscode.trim(),
        },
      });
      onLoginSuccess({ role: 'staff', token: res.token, staffName: res.staffName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk sebagai Staf Administrasi.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStaffClaim(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const normalizedUsername = claimUsername.trim().toLowerCase() || 'admin';
    if (!/^[a-z0-9._-]{3,40}$/.test(normalizedUsername)) {
      setError('Username staf minimal 3 karakter (hanya huruf kecil, angka, titik, _, atau -).');
      return;
    }
    if (claimPasscode.trim().length < 6) {
      setError('Kata sandi Staf Administrasi minimal 6 karakter.');
      return;
    }
    if (claimPasscode !== claimConfirm) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{
        token: string;
        role: 'staff';
        staffName: string;
      }>('/api/auth/staff/claim', {
        method: 'POST',
        body: {
          staffName: claimName.trim() || 'Staf Administrasi Akademik',
          username: normalizedUsername,
          passcode: claimPasscode.trim(),
        },
      });
      onLoginSuccess({ role: 'staff', token: res.token, staffName: res.staffName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan kata sandi Staf Administrasi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white grid grid-cols-1 lg:grid-cols-12 items-stretch">
      {/* Kolom Kiri: Formulir Masuk */}
      <div className="lg:col-span-5 flex flex-col justify-between px-6 py-8 sm:px-12 lg:px-14 border-b lg:border-b-0 lg:border-r border-amber-200 bg-white">
        <div>
          <div className="flex items-center gap-3">
            {!emblemFailed ? (
              <img
                src={DEFAULT_UNIVERSITY_LOGO_URL}
                alt="Lambang Universitas Kaltara"
                referrerPolicy="no-referrer"
                onError={() => setEmblemFailed(true)}
                className="w-11 h-11 object-contain shrink-0 mix-blend-multiply"
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-orange-600 text-white flex items-center justify-center font-display font-bold text-sm shrink-0">
                UK
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-orange-700">Universitas Kaltara</p>
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-stone-950 leading-snug">
                Layanan Administrasi Akademik Fakultas Ekonomi
              </h1>
            </div>
          </div>

          <div className="mt-4">
            <PWAInstallButton />
          </div>

          <div className="mt-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-stone-950 text-balance">
              Masuk ke Layanan Surat Akademik
            </h2>
            <p className="text-sm text-stone-600 mt-2.5 leading-relaxed">
              Pilih peran Anda untuk mengajukan surat mahasiswa melalui NPM/NIM atau memverifikasi
              pengajuan sebagai Staf Administrasi.
            </p>
          </div>

          {/* Role Switcher Tabs */}
          <div
            role="tablist"
            aria-label="Pilih Peran Masuk"
            className="mt-7 grid grid-cols-2 gap-1 p-1 bg-amber-100/80 border border-amber-200 rounded-lg"
          >
            <button
              type="button"
              role="tab"
              aria-selected={roleTab === 'student'}
              onClick={() => {
                setRoleTab('student');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                roleTab === 'student'
                  ? 'bg-orange-600 text-white shadow-xs'
                  : 'text-amber-950 hover:bg-amber-200/60'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Portal Mahasiswa</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={roleTab === 'staff'}
              onClick={() => {
                setRoleTab('staff');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                roleTab === 'staff'
                  ? 'bg-orange-600 text-white shadow-xs'
                  : 'text-amber-950 hover:bg-amber-200/60'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Staf Administrasi</span>
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 p-3.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md leading-relaxed"
            >
              {error}
            </div>
          )}

          {roleTab === 'student' ? (
            <form onSubmit={handleStudentLogin} className="mt-6 space-y-5">
              <div>
                <label
                  htmlFor="nim-input"
                  className="block text-xs font-semibold text-stone-800 mb-1.5"
                >
                  Nomor Induk Mahasiswa (NPM / NIM)
                </label>
                <input
                  id="nim-input"
                  type="text"
                  value={nim}
                  onChange={(e) => setNim(e.target.value)}
                  placeholder="Contoh: 202541012"
                  autoComplete="username"
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-amber-300 rounded-md text-stone-950 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                />
                <p className="text-xs text-stone-500 mt-1.5 leading-relaxed">
                  Gunakan NPM/NIM yang telah terdaftar melalui unggahan data Excel Staf Administrasi.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60 transition-colors"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                <span>Masuk Portal Mahasiswa</span>
              </button>

              <div className="pt-4 border-t border-amber-200">
                <p className="text-xs font-medium text-stone-600 mb-2">
                  Contoh cepat NPM / NIM dari basis data mahasiswa:
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNim('202541012');
                      setError(null);
                    }}
                    className="px-2.5 py-1.5 text-xs font-mono text-amber-950 bg-amber-100/80 hover:bg-amber-200 border border-amber-300 rounded transition-colors"
                  >
                    202541012 · TRI DIAH CAHYA AYU PRATIWI
                  </button>
                </div>
              </div>
            </form>
          ) : staffStatus && !staffStatus.configured ? (
            <form onSubmit={handleStaffClaim} className="mt-6 space-y-4">
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-md">
                <p className="text-xs font-semibold text-amber-950">
                  Aktivasi Kata Sandi Staf Administrasi
                </p>
                <p className="text-xs text-amber-900 mt-1 leading-relaxed">
                  Belum ada kata sandi Staf Administrasi yang tersimpan. Buat kata sandi akses
                  staf untuk memulai verifikasi surat dan impor Excel mahasiswa.
                </p>
              </div>

              <div>
                <label
                  htmlFor="claim-staff-name"
                  className="block text-xs font-semibold text-stone-800 mb-1.5"
                >
                  Nama Petugas Administrasi Utama
                </label>
                <input
                  id="claim-staff-name"
                  type="text"
                  value={claimName}
                  onChange={(e) => setClaimName(e.target.value)}
                  placeholder="Contoh: Staf Administrasi Akademik"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                />
              </div>

              <div>
                <label
                  htmlFor="claim-staff-username"
                  className="block text-xs font-semibold text-stone-800 mb-1.5"
                >
                  Username Staf Utama
                </label>
                <input
                  id="claim-staff-username"
                  type="text"
                  value={claimUsername}
                  onChange={(e) => setClaimUsername(e.target.value.toLowerCase())}
                  placeholder="admin"
                  autoComplete="username"
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                />
                <p className="text-[11px] text-stone-500 mt-1">
                  Huruf kecil, angka, titik, garis bawah (_), atau tanda hubung (-).
                </p>
              </div>

              <div>
                <label
                  htmlFor="claim-passcode"
                  className="block text-xs font-semibold text-stone-800 mb-1.5"
                >
                  Buat Kata Sandi Staf (Min. 6 Karakter)
                </label>
                <input
                  id="claim-passcode"
                  type="password"
                  required
                  value={claimPasscode}
                  onChange={(e) => setClaimPasscode(e.target.value)}
                  placeholder="Masukkan kata sandi"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                />
              </div>

              <div>
                <label
                  htmlFor="claim-confirm"
                  className="block text-xs font-semibold text-stone-800 mb-1.5"
                >
                  Konfirmasi Kata Sandi
                </label>
                <input
                  id="claim-confirm"
                  type="password"
                  required
                  value={claimConfirm}
                  onChange={(e) => setClaimConfirm(e.target.value)}
                  placeholder="Ulangi kata sandi"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-amber-300 rounded-md text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60 transition-colors"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <KeyRound className="w-4 h-4" />
                )}
                <span>Simpan Sandi & Masuk Staf</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleStaffLogin} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="staff-username"
                  className="block text-xs font-semibold text-stone-800 mb-1.5"
                >
                  Username Staf Administrasi
                </label>
                <input
                  id="staff-username"
                  type="text"
                  value={staffUsername}
                  onChange={(e) => setStaffUsername(e.target.value)}
                  placeholder="Contoh: admin atau username staf"
                  autoComplete="username"
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-amber-300 rounded-md text-stone-950 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                />
                <p className="text-[11px] text-stone-500 mt-1">
                  Masukkan username akun staf Anda, atau kosongkan jika masuk dengan sandi admin utama.
                </p>
              </div>

              <div>
                <label
                  htmlFor="staff-passcode"
                  className="block text-xs font-semibold text-stone-800 mb-1.5"
                >
                  Kata Sandi Staf Administrasi
                </label>
                <div className="relative">
                  <input
                    id="staff-passcode"
                    type={showPasscode ? 'text' : 'password'}
                    value={staffPasscode}
                    onChange={(e) => setStaffPasscode(e.target.value)}
                    placeholder="Masukkan kata sandi staf"
                    autoComplete="current-password"
                    className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-white border border-amber-300 rounded-md text-stone-950 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasscode((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700"
                    aria-label={showPasscode ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                  >
                    {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-stone-500 mt-1.5 leading-relaxed">
                  Gunakan akun Staf Administrasi untuk mengelola data Excel mahasiswa,
                  memverifikasi dokumen, dan mengatur formulir surat.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-60 transition-colors"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                <span>Masuk Portal Staf</span>
              </button>
            </form>
          )}
        </div>

        <p className="text-xs text-stone-500 mt-10">
          Universitas Kaltara · Layanan Administrasi Akademik Fakultas Ekonomi
        </p>
      </div>

      {/* Kolom Kanan: Statistik Mahasiswa Aktif & Alur Layanan */}
      <div className="lg:col-span-7 flex flex-col bg-amber-50/50">
        {/* Banner Kampus & Alur Layanan */}
        <div className="relative h-60 sm:h-64 bg-amber-950 overflow-hidden shrink-0">
          {!campusImgFailed ? (
            <img
              src="/assets/aistudio/Kampus_Baru_fe4c1823.JPG"
              alt="Gedung Kampus Universitas Kaltara"
              referrerPolicy="no-referrer"
              onError={() => setCampusImgFailed(true)}
              className="w-full h-full object-cover object-center scale-[1.03]"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-amber-900 via-orange-900 to-amber-950 flex items-center justify-center">
              <Building2 className="w-16 h-16 text-amber-300" />
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-amber-950/90 via-orange-950/55 to-amber-950/20" />

          <div className="absolute inset-x-0 bottom-0 p-6 sm:px-10 sm:py-6 text-white">
            <p className="text-xs font-semibold tracking-wide text-amber-300">
              Alur Persuratan Terintegrasi
            </p>
            <h3 className="text-lg sm:text-xl font-bold tracking-tight mt-1 max-w-2xl text-balance">
              Layanan Persuratan Akademik &lt;&gt; Cepat, Mudah, dan Terdokumentasi
            </h3>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-amber-200/25">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-50">
                <FileSpreadsheet className="w-4 h-4 text-amber-300 shrink-0" aria-hidden="true" />
                <span>01. Sinkronisasi Excel</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-amber-50">
                <UserCheck className="w-4 h-4 text-amber-300 shrink-0" aria-hidden="true" />
                <span>02. Pengajuan via NPM/NIM</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-amber-50">
                <ShieldCheck className="w-4 h-4 text-amber-300 shrink-0" aria-hidden="true" />
                <span>03. Verifikasi Digital</span>
              </div>
            </div>
          </div>
        </div>

        {/* Statistik Mahasiswa Aktif per Angkatan */}
        <section
          aria-label="Statistik Mahasiswa Aktif per Angkatan"
          className="flex-1 p-6 sm:px-10 sm:py-8 flex flex-col justify-between"
        >
          <div>
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-amber-200">
              <div>
                <div className="flex items-center gap-2 text-orange-700">
                  <BarChart3 className="w-4 h-4 text-orange-600 shrink-0" aria-hidden="true" />
                  <span className="text-xs font-semibold">Statistik Basis Data Akademik</span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold tracking-tight text-stone-950 mt-1">
                  Mahasiswa Aktif per Angkatan
                </h3>
                <p className="text-xs text-stone-600 mt-0.5">
                  Jurusan Manajemen dan Ekonomi Pembangunan · Fakultas Ekonomi Universitas Kaltara
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="inline-flex items-center p-0.5 bg-amber-100/90 border border-amber-200 rounded-md">
                  <button
                    type="button"
                    onClick={() => setCohortFilter('recent')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 ${
                      cohortFilter === 'recent'
                        ? 'bg-orange-600 text-white shadow-xs'
                        : 'text-amber-950 hover:bg-amber-200/70'
                    }`}
                  >
                    5 Terbaru
                  </button>
                  <button
                    type="button"
                    onClick={() => setCohortFilter('all')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 ${
                      cohortFilter === 'all'
                        ? 'bg-orange-600 text-white shadow-xs'
                        : 'text-amber-950 hover:bg-amber-200/70'
                    }`}
                  >
                    Semua Angkatan
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-950 bg-white border border-amber-300 rounded-md hover:bg-amber-50 transition-colors whitespace-nowrap shrink-0"
                  title="Ubah urutan tahun angkatan"
                >
                  <ArrowDownUp className="w-3.5 h-3.5 text-orange-600" aria-hidden="true" />
                  <span>{sortOrder === 'desc' ? 'Terbaru' : 'Terlama'}</span>
                </button>
              </div>
            </div>

            {statsLoading ? (
              <div className="mt-5 space-y-3" aria-busy="true">
                <div className="grid grid-cols-3 gap-4">
                  <div className="h-16 bg-amber-100/80 rounded-md animate-pulse" />
                  <div className="h-16 bg-amber-100/80 rounded-md animate-pulse" />
                  <div className="h-16 bg-amber-100/80 rounded-md animate-pulse" />
                </div>
                <div className="h-64 bg-amber-100/60 rounded-md animate-pulse" />
              </div>
            ) : statsError ? (
              <div className="mt-5 p-4 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md">
                {statsError}
              </div>
            ) : !cohortStats || cohortStats.cohorts.length === 0 ? (
              <div className="mt-5 p-6 bg-white border border-amber-200 rounded-md text-center">
                <p className="text-sm font-semibold text-stone-900">
                  Belum ada data mahasiswa aktif
                </p>
                <p className="text-xs text-stone-500 mt-1">
                  Statistik jumlah mahasiswa aktif per angkatan akan tampil otomatis setelah data
                  Excel mahasiswa diunggah oleh Staf Administrasi.
                </p>
              </div>
            ) : (
              <>
                {/* Ringkasan Agregat 3 Kolom */}
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-amber-400/20 border border-amber-300 rounded-md px-4 py-3">
                    <p className="text-xs font-semibold text-amber-900">Total Mahasiswa Aktif</p>
                    <p className="text-2xl font-bold tracking-tight text-stone-950 font-mono tabular-nums mt-0.5">
                      {cohortStats.totalAktif.toLocaleString('id-ID')}
                    </p>
                    <p className="text-xs text-amber-900/80 mt-0.5 tabular-nums">
                      {cohortStats.cohorts.length} angkatan aktif
                    </p>
                  </div>

                  <div className="bg-white border border-amber-200 rounded-md px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-stone-600">Jurusan Manajemen</p>
                      <span className="w-2.5 h-2.5 rounded-xs bg-orange-600 shrink-0" aria-hidden="true" />
                    </div>
                    <p className="text-2xl font-bold tracking-tight text-stone-950 font-mono tabular-nums mt-0.5">
                      {cohortStats.totalManajemen.toLocaleString('id-ID')}
                    </p>
                    <p className="text-xs text-stone-500 mt-0.5 tabular-nums">
                      {cohortStats.totalAktif > 0
                        ? `${Math.round((cohortStats.totalManajemen / cohortStats.totalAktif) * 100)}% dari mahasiswa aktif`
                        : '0%'}
                    </p>
                  </div>

                  <div className="bg-white border border-amber-200 rounded-md px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-stone-600">
                        Ekonomi Pembangunan
                      </p>
                      <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 shrink-0" aria-hidden="true" />
                    </div>
                    <p className="text-2xl font-bold tracking-tight text-stone-950 font-mono tabular-nums mt-0.5">
                      {cohortStats.totalEkonomiPembangunan.toLocaleString('id-ID')}
                    </p>
                    <p className="text-xs text-stone-500 mt-0.5 tabular-nums">
                      {cohortStats.totalAktif > 0
                        ? `${Math.round((cohortStats.totalEkonomiPembangunan / cohortStats.totalAktif) * 100)}% dari mahasiswa aktif`
                        : '0%'}
                    </p>
                  </div>
                </div>

                {/* Tabel Rincian per Angkatan */}
                <div className="mt-4 bg-white border border-amber-200 rounded-md overflow-hidden">
                  <div className="max-h-[340px] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 z-10 bg-amber-100/90 border-b border-amber-200">
                        <tr className="text-xs font-semibold text-amber-950">
                          <th className="py-2.5 px-4">Angkatan</th>
                          <th className="py-2.5 px-4 text-right">Manajemen</th>
                          <th className="py-2.5 px-4 text-right">Ekonomi Pembangunan</th>
                          <th className="py-2.5 px-4 text-right">Total Aktif</th>
                          <th className="py-2.5 px-4 hidden sm:table-cell w-40">Distribusi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100 text-xs">
                        {visibleCohorts.map((row) => {
                          const manajemenWidth = Math.round(
                            (row.manajemen / maxCohortTotal) * 100
                          );
                          const epWidth = Math.round(
                            (row.ekonomiPembangunan / maxCohortTotal) * 100
                          );
                          return (
                            <tr
                              key={row.angkatan}
                              className="hover:bg-amber-50/70 transition-colors"
                            >
                              <td className="py-2 px-4 font-semibold text-stone-900 font-mono tabular-nums">
                                {row.angkatan}
                              </td>
                              <td className="py-2 px-4 text-right font-mono tabular-nums text-stone-800">
                                {row.manajemen.toLocaleString('id-ID')}
                              </td>
                              <td className="py-2 px-4 text-right font-mono tabular-nums text-stone-800">
                                {row.ekonomiPembangunan.toLocaleString('id-ID')}
                              </td>
                              <td className="py-2 px-4 text-right font-semibold font-mono tabular-nums text-stone-950">
                                {row.total.toLocaleString('id-ID')}
                              </td>
                              <td className="py-2 px-4 hidden sm:table-cell">
                                <div
                                  className="w-full h-2.5 bg-amber-100/80 rounded-xs overflow-hidden flex"
                                  aria-hidden="true"
                                >
                                  {row.manajemen > 0 && (
                                    <div
                                      className="h-full bg-orange-600"
                                      style={{ width: `${Math.max(manajemenWidth, 2)}%` }}
                                    />
                                  )}
                                  {row.ekonomiPembangunan > 0 && (
                                    <div
                                      className="h-full bg-amber-400"
                                      style={{ width: `${Math.max(epWidth, 2)}%` }}
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-amber-50 border-t border-amber-200">
                        <tr className="text-xs font-bold text-stone-950">
                          <td className="py-2.5 px-4">
                            {cohortFilter === 'recent' ? 'Subtotal (5 Terbaru)' : 'Total Keseluruhan'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-orange-700">
                            {visibleCohorts
                              .reduce((sum, item) => sum + item.manajemen, 0)
                              .toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700">
                            {visibleCohorts
                              .reduce((sum, item) => sum + item.ekonomiPembangunan, 0)
                              .toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                            {visibleCohorts
                              .reduce((sum, item) => sum + item.total, 0)
                              .toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-4 hidden sm:table-cell text-[11px] font-normal text-stone-500">
                            Status: Aktif
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-orange-600" aria-hidden="true" />
                <span>S1 Manajemen</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-400" aria-hidden="true" />
                <span>S1 Ekonomi Pembangunan</span>
              </span>
            </div>
            <span>Sumber: Basis data mahasiswa Fakultas Ekonomi · Status Aktif</span>
          </div>
        </section>
      </div>
    </div>
  );
}
