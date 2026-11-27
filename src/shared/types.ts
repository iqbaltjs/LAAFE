export type UserRole = 'student' | 'staff';

export type LetterTypeId =
  | 'AKTIF_KULIAH'
  | 'MAGANG_PKL'
  | 'IZIN_PENELITIAN'
  | 'IZIN_OBSERVASI'
  | 'REKOMENDASI_BEASISWA'
  | 'KETERANGAN_LULUS'
  | 'PINDAH_KULIAH';

export type RequestStatus =
  | 'Menunggu Berkas'
  | 'Menunggu Verifikasi'
  | 'Sedang Diproses'
  | 'Perlu Revisi'
  | 'Disetujui'
  | 'Ditolak';

export interface StudentRecord {
  nim: string;
  nama: string;
  prodi: string;
  fakultas: string;
  angkatan: string;
  semester: number;
  ipk: string;
  email: string;
  no_hp: string;
  tempat_lahir: string;
  tanggal_lahir: string;
  jenis_kelamin: string;
  nik: string;
  jenjang: string;
  alamat: string;
  status_akademik: string;
  updated_at: string;
}

export interface StudentCompletenessStats {
  total: number;
  completeCount: number;
  incompleteCount: number;
  missingCounts: {
    nik: number;
    tempat_lahir: number;
    tanggal_lahir: number;
    jenis_kelamin: number;
    email: number;
    no_hp: number;
    alamat: number;
  };
}

export interface ActiveCohortStat {
  angkatan: string;
  manajemen: number;
  ekonomiPembangunan: number;
  total: number;
}

export interface ActiveStudentStatsSummary {
  totalAktif: number;
  totalManajemen: number;
  totalEkonomiPembangunan: number;
  cohorts: ActiveCohortStat[];
}

export const TRACKED_COMPLETENESS_FIELDS: {
  key: 'nik' | 'tempat_lahir' | 'tanggal_lahir' | 'jenis_kelamin' | 'email' | 'no_hp' | 'alamat';
  label: string;
}[] = [
  { key: 'nik', label: 'NIK' },
  { key: 'tempat_lahir', label: 'Tempat Lahir' },
  { key: 'tanggal_lahir', label: 'Tanggal Lahir' },
  { key: 'jenis_kelamin', label: 'Jenis Kelamin' },
  { key: 'email', label: 'Email' },
  { key: 'no_hp', label: 'No. HP' },
  { key: 'alamat', label: 'Alamat' },
];

export function getMissingStudentFields(
  student: Partial<StudentRecord>
): { key: string; label: string }[] {
  return TRACKED_COMPLETENESS_FIELDS.filter((f) => {
    const val = String(student[f.key] || '').trim();
    return val.length === 0;
  });
}

export interface UploadedDocument {
  id: string;
  request_id: string;
  doc_type: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  stored_name: string;
  uploaded_at: string;
}

export interface VerificationChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface LetterRequest {
  id: string;
  tracking_code: string;
  student_nim: string;
  letter_type: LetterTypeId;
  status: RequestStatus;
  form_data: Record<string, string>;
  verification_notes: string;
  verified_by: string;
  verified_at: string | null;
  official_number: string;
  signatory_name: string;
  signatory_nidn: string;
  signatory_title: string;
  signatory_nik: string;
  checklist: VerificationChecklistItem[];
  manual_pdf_name?: string;
  manual_pdf_size?: number;
  manual_pdf_uploaded_at?: string | null;
  created_at: string;
  updated_at: string;
  student?: StudentRecord;
  documents?: UploadedDocument[];
}

export interface FormFieldDef {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'select';
  placeholder: string;
  required: boolean;
  options?: string[];
  autoFillFrom?: keyof StudentRecord;
  locked?: boolean;
  defaultValue?: string;
}

export interface RequiredDocumentDef {
  id: string;
  label: string;
  description: string;
  required: boolean;
  templateUrl?: string;
  templateFileName?: string;
}

export const DEFAULT_DEAN_SIGNATURE_URL = '/assets/aistudio/Tanda_Tangan_Dekan_Dewi_1a35101e.png';
export const DEFAULT_UNIVERSITY_LOGO_URL = '/assets/aistudio/LOGO_UNIKAL_OK2_ca1d6e37.jpg';

export const DEFAULT_DEAN_STAMP_URL = '/assets/aistudio/Stempel_Dekan_2025-removebg-preview_5476ffed.png';

export interface LetterTemplateSettings {
  signatory_name: string;
  signatory_nidn: string;
  signatory_title: string;
  signatory_role_heading: string;
  signatory_nik: string;
  letter_city: string;
  institution_foundation: string;
  institution_university: string;
  institution_faculty: string;
  institution_address: string;
  number_middle_code: string;
  aktif_kuliah_signature_enabled: boolean;
  aktif_kuliah_signature_url: string;
  aktif_kuliah_stamp_enabled: boolean;
  aktif_kuliah_stamp_url: string;
}

export const DEFAULT_LETTER_SETTINGS: LetterTemplateSettings = {
  signatory_name: 'Dewi Qomariah Imelda, SE., MM.Ak',
  signatory_nidn: '11.050573.02',
  signatory_title: 'Dekan Fakultas Ekonomi Universitas Kaltara',
  signatory_role_heading: 'DEKAN,',
  signatory_nik: '1973.2009.01.08',
  letter_city: 'Tanjung Selor',
  institution_foundation: 'YAYASAN PENDIDIKAN TANAH SERIBU',
  institution_university: 'UNIVERSITAS KALTARA',
  institution_faculty: 'FAKULTAS EKONOMI',
  institution_address:
    'Kampus Unikaltar Jalan Sengkawit, Tanjung Selor, Telp. (0552) 2033202, https://unikaltar.ac.id',
  number_middle_code: 'FE.UNIKALTAR/YAPETAS',
  aktif_kuliah_signature_enabled: true,
  aktif_kuliah_signature_url: DEFAULT_DEAN_SIGNATURE_URL,
  aktif_kuliah_stamp_enabled: true,
  aktif_kuliah_stamp_url: DEFAULT_DEAN_STAMP_URL,
};

export interface LetterServiceDefinition {
  id: LetterTypeId;
  code: string;
  title: string;
  shortTitle: string;
  category: string;
  description: string;
  estimatedDays: string;
  letterSubject: string;
  formFields: FormFieldDef[];
  requiredDocuments: RequiredDocumentDef[];
  defaultChecklist: string[];
}

export const LETTER_SERVICES: LetterServiceDefinition[] = [
  {
    id: 'AKTIF_KULIAH',
    code: 'SK-AK',
    title: 'Surat Keterangan Aktif Kuliah',
    shortTitle: 'Aktif Kuliah',
    category: 'Status Akademik',
    description:
      'Dokumen resmi yang menyatakan mahasiswa terdaftar aktif pada semester berjalan untuk keperluan tunjangan orang tua, BPJS, atau administrasi umum.',
    estimatedDays: '1–2 Hari Kerja',
    letterSubject: 'SURAT KETERANGAN AKTIF KULIAH',
    formFields: [
      {
        name: 'nik',
        label: 'Nomor Induk Kependudukan (NIK)',
        type: 'text',
        placeholder: 'Contoh: 6404094704050002',
        required: true,
        autoFillFrom: 'nik',
      },
      {
        name: 'tempat_lahir',
        label: 'Tempat Lahir',
        type: 'text',
        placeholder: 'Contoh: TARAKAN',
        required: true,
        autoFillFrom: 'tempat_lahir',
      },
      {
        name: 'tanggal_lahir',
        label: 'Tanggal Lahir',
        type: 'date',
        placeholder: '',
        required: true,
        autoFillFrom: 'tanggal_lahir',
      },
      {
        name: 'jenis_kelamin',
        label: 'Jenis Kelamin',
        type: 'select',
        placeholder: 'Pilih jenis kelamin',
        required: true,
        options: ['Laki-laki', 'Perempuan'],
        autoFillFrom: 'jenis_kelamin',
      },
      {
        name: 'jenjang',
        label: 'Jenjang Pendidikan',
        type: 'select',
        placeholder: 'Pilih jenjang',
        required: true,
        options: ['SARJANA (S1)', 'DIPLOMA (D3)', 'MAGISTER (S2)'],
        autoFillFrom: 'jenjang',
      },
      {
        name: 'mulai_studi',
        label: 'Memulai Studi Pada',
        type: 'text',
        placeholder: 'Contoh: Semester ganjil Tahun Akademik 2025 / 2026',
        required: true,
      },
      {
        name: 'alamat',
        label: 'Alamat Lengkap',
        type: 'textarea',
        placeholder: 'Contoh: Jln. BELUAN, SESAYAP HILIR',
        required: true,
        autoFillFrom: 'alamat',
      },
      {
        name: 'keperluan',
        label: 'Keperluan Surat',
        type: 'select',
        placeholder: 'Pilih keperluan surat',
        required: true,
        options: [
          'Persyaratan pengurusan Beasiswa',
          'Persyaratan pengurusan BPJS Kesehatan',
          'Persyaratan pengurusan Tunjangan',
        ],
      },
    ],
    requiredDocuments: [],
    defaultChecklist: [
      'Identitas NPM, NIK, dan status aktif mahasiswa sesuai database Excel',
      'Tempat/tanggal lahir, jenis kelamin, dan alamat sesuai identitas',
    ],
  },
  {
    id: 'MAGANG_PKL',
    code: 'SP-MG',
    title: 'Surat Pengantar Magang / PKL',
    shortTitle: 'Pengantar Magang',
    category: 'Karier & Industri',
    description:
      'Surat permohonan resmi fakultas kepada perusahaan atau instansi mitra untuk pelaksanaan Praktik Kerja Lapangan atau Magang Akademik.',
    estimatedDays: '2–3 Hari Kerja',
    letterSubject: 'PERMOHONAN IZIN PRAKTIK KERJA LAPANGAN / MAGANG',
    formFields: [
      {
        name: 'nama_instansi',
        label: 'Nama Perusahaan / Instansi Tujuan',
        type: 'text',
        placeholder: 'Contoh: PT Telkom Indonesia (Persero) Tbk',
        required: true,
      },
      {
        name: 'jabatan_penerima',
        label: 'Ditujukan Kepada (Jabatan Penerima)',
        type: 'text',
        placeholder: 'Contoh: Kepala Divisi Human Capital / HRD Manager',
        required: true,
      },
      {
        name: 'alamat_instansi',
        label: 'Alamat Lengkap Instansi',
        type: 'textarea',
        placeholder: 'Jalan, nomor gedung, kota, dan kode pos instansi tujuan',
        required: true,
      },
      {
        name: 'tanggal_mulai',
        label: 'Tanggal Mulai Magang',
        type: 'date',
        placeholder: '',
        required: true,
      },
      {
        name: 'tanggal_selesai',
        label: 'Tanggal Selesai Magang',
        type: 'date',
        placeholder: '',
        required: true,
      },
      {
        name: 'bidang_magang',
        label: 'Divisi / Topik Bidang Magang',
        type: 'text',
        placeholder: 'Contoh: Rekayasa Perangkat Lunak & Analisis Data',
        required: true,
      },
    ],
    requiredDocuments: [
      {
        id: 'transkrip',
        label: 'Transkrip Nilai Sementara',
        description: 'Menunjukkan pemenuhan SKS minimum sesuai syarat prodi.',
        required: true,
      },
      {
        id: 'proposal_magang',
        label: 'Proposal Singkat / Persetujuan Koordinator PKL',
        description: 'Dokumen persetujuan atau kerangka rencana kegiatan magang.',
        required: true,
      },
    ],
    defaultChecklist: [
      'Mahasiswa memenuhi syarat semester dan status akademik aktif',
      'Nama dan alamat instansi tujuan tertulis lengkap',
      'Transkrip nilai sementara dan persetujuan koordinator PKL terlampir',
    ],
  },
  {
    id: 'IZIN_PENELITIAN',
    code: 'SI-PN',
    title: 'Surat Izin Penelitian / Tugas Akhir',
    shortTitle: 'Izin Penelitian',
    category: 'Tugas Akhir',
    description:
      'Surat pengantar akademik untuk pengambilan data, wawancara, atau observasi lapangan dalam rangka penyusunan skripsi atau tugas akhir.',
    estimatedDays: '2–3 Hari Kerja',
    letterSubject: 'PERMOHONAN IZIN PENELITIAN SKRIPSI / TUGAS AKHIR',
    formFields: [
      {
        name: 'judul_penelitian',
        label: 'Judul Penelitian / Skripsi',
        type: 'textarea',
        placeholder: 'Tuliskan judul lengkap penelitian sesuai lembar pengesahan proposal',
        required: true,
      },
      {
        name: 'lokasi_penelitian',
        label: 'Instansi / Lokasi Penelitian',
        type: 'text',
        placeholder: 'Contoh: Dinas Perindustrian dan Perdagangan Provinsi Kalimantan Utara',
        required: true,
      },
      {
        name: 'pimpinan_tujuan',
        label: 'Tujuan Surat (Pimpinan Instansi)',
        type: 'text',
        placeholder: 'Contoh: Kepala Dinas / Direktur Utama',
        required: true,
      },
      {
        name: 'periode_penelitian',
        label: 'Periode Pelaksanaan Penelitian',
        type: 'text',
        placeholder: 'Contoh: Desember 2026 – Februari 2027',
        required: true,
      },
      {
        name: 'dosen_pembimbing',
        label: 'Nama Dosen Pembimbing Utama',
        type: 'text',
        placeholder: 'Contoh: Dr. Eng. Hendra Wijaya, M.T.',
        required: true,
      },
    ],
    requiredDocuments: [
      {
        id: 'pengesahan_proposal',
        label: 'Lembar Persetujuan / Pengesahan Proposal Skripsi',
        description: 'Telah ditandatangani oleh dosen pembimbing atau ketua prodi.',
        required: true,
      },
      {
        id: 'ktm',
        label: 'Scan Kartu Tanda Mahasiswa (KTM)',
        description: 'Format PDF, JPG, atau PNG.',
        required: true,
      },
    ],
    defaultChecklist: [
      'Judul penelitian sesuai dengan lembar persetujuan pembimbing',
      'Lembar pengesahan proposal bertanda tangan terlampir',
      'Identitas mahasiswa sesuai dengan database akademik',
    ],
  },
  {
    id: 'REKOMENDASI_BEASISWA',
    code: 'SR-BS',
    title: 'Surat Rekomendasi Beasiswa',
    shortTitle: 'Rekomendasi Beasiswa',
    category: 'Kemahasiswaan',
    description:
      'Surat rekomendasi resmi dari pimpinan fakultas yang menerangkan prestasi akademik serta kelayakan mahasiswa mengikuti seleksi beasiswa.',
    estimatedDays: '2 Hari Kerja',
    letterSubject: 'SURAT REKOMENDASI PENERIMA BEASISWA',
    formFields: [
      {
        name: 'nama_beasiswa',
        label: 'Nama Program Beasiswa',
        type: 'text',
        placeholder: 'Contoh: Beasiswa Bank Indonesia / LPDP / Djarum Plus',
        required: true,
      },
      {
        name: 'penyelenggara',
        label: 'Lembaga Penyelenggara',
        type: 'text',
        placeholder: 'Contoh: Bank Indonesia / Kementerian Keuangan RI',
        required: true,
      },
      {
        name: 'ipk_terakhir',
        label: 'IPK Terakhir',
        type: 'text',
        placeholder: 'Contoh: 3.78',
        required: true,
        autoFillFrom: 'ipk',
      },
      {
        name: 'prestasi_pendukung',
        label: 'Ringkasan Prestasi / Aktivitas Organisasi',
        type: 'textarea',
        placeholder: 'Sebutkan capaian akademik, lomba, atau kepengurusan organisasi mahasiswa',
        required: true,
      },
    ],
    requiredDocuments: [
      {
        id: 'transkrip_resmi',
        label: 'Transkrip Nilai Kumulatif',
        description: 'Memuat IPK kumulatif hingga semester terakhir.',
        required: true,
      },
      {
        id: 'pernyataan_beasiswa',
        label: 'Bukti Pendaftaran / Sertifikat Prestasi Pendukung',
        description: 'Tangkapan layar portal beasiswa atau piagam prestasi.',
        required: false,
      },
    ],
    defaultChecklist: [
      'IPK pada formulir cocok dengan transkrip nilai dan data Excel',
      'Mahasiswa tidak berstatus cuti atau non-aktif',
      'Dokumen transkrip kumulatif terverifikasi',
    ],
  },
  {
    id: 'KETERANGAN_LULUS',
    code: 'SK-LS',
    title: 'Surat Keterangan Lulus Sementara (SKL)',
    shortTitle: 'Keterangan Lulus',
    category: 'Kelulusan',
    description:
      'Dokumen pengganti sementara sebelum ijazah asli diterbitkan untuk keperluan melamar pekerjaan atau pendaftaran studi lanjut.',
    estimatedDays: '2–3 Hari Kerja',
    letterSubject: 'SURAT KETERANGAN LULUS SEMENTARA',
    formFields: [
      {
        name: 'tanggal_yudisium',
        label: 'Tanggal Yudisium / Sidang Akhir',
        type: 'date',
        placeholder: '',
        required: true,
      },
      {
        name: 'judul_tugas_akhir',
        label: 'Judul Skripsi / Tugas Akhir',
        type: 'textarea',
        placeholder: 'Tuliskan judul akhir yang disetujui saat sidang yudisium',
        required: true,
      },
      {
        name: 'ipk_akhir',
        label: 'IPK Akhir',
        type: 'text',
        placeholder: 'Contoh: 3.84',
        required: true,
        autoFillFrom: 'ipk',
      },
      {
        name: 'predikat',
        label: 'Predikat Kelulusan',
        type: 'select',
        placeholder: 'Pilih predikat kelulusan',
        required: true,
        options: [
          'Dengan Pujian (Cum Laude)',
          'Sangat Memuaskan',
          'Memuaskan',
        ],
      },
    ],
    requiredDocuments: [
      {
        id: 'berita_acara_yudisium',
        label: 'Berita Acara Sidang / Surat Keterangan Yudisium',
        description: 'Dokumen resmi hasil kelulusan sidang dari program studi.',
        required: true,
      },
      {
        id: 'bebas_pustaka',
        label: 'Surat Bebas Pustaka & Administrasi',
        description: 'Bukti penyelesaian tanggungan perpustakaan dan laboratorium.',
        required: true,
      },
    ],
    defaultChecklist: [
      'Berita acara sidang atau SK yudisium valid dan lengkap',
      'Surat keterangan bebas pustaka terlampir',
      'IPK akhir dan judul tugas akhir sesuai berkas yudisium',
    ],
  },
  {
    id: 'IZIN_OBSERVASI',
    code: 'SI-OB',
    title: 'Surat Izin Observasi',
    shortTitle: 'Izin Observasi',
    category: 'Perkuliahan & Lapangan',
    description:
      'Surat pengantar resmi fakultas untuk pelaksanaan observasi lapangan (individu maupun kelompok), survei awal, atau wawancara pada instansi/perusahaan untuk tugas mata kuliah atau pra-penelitian.',
    estimatedDays: '1–2 Hari Kerja',
    letterSubject: 'PERMOHONAN IZIN OBSERVASI LAPANGAN',
    formFields: [
      {
        name: 'jenis_observasi',
        label: 'Jenis Observasi',
        type: 'select',
        placeholder: 'Pilih jenis observasi',
        required: true,
        options: ['Observasi Individu', 'Observasi Kelompok'],
        defaultValue: 'Observasi Individu',
      },
      {
        name: 'anggota_kelompok',
        label: 'Daftar Nama & NPM Anggota Kelompok',
        type: 'textarea',
        placeholder:
          'Tuliskan nama dan NPM anggota kelompok (1 baris per mahasiswa), contoh:\n1. Siti Rahmawati (202411002)\n2. Andi Pratama (202411005)',
        required: false,
      },
      {
        name: 'mata_kuliah',
        label: 'Mata Kuliah / Keperluan Observasi',
        type: 'text',
        placeholder: 'Contoh: Manajemen Operasional / Pra-Penelitian Skripsi',
        required: true,
      },
      {
        name: 'topik_observasi',
        label: 'Topik / Fokus Observasi',
        type: 'textarea',
        placeholder: 'Tuliskan topik atau objek yang akan diobservasi pada instansi tujuan',
        required: true,
      },
      {
        name: 'nama_instansi',
        label: 'Instansi / Perusahaan Tujuan',
        type: 'text',
        placeholder: 'Contoh: Dinas Koperasi UMKM Kab. Bulungan / Bankaltimtara',
        required: true,
      },
      {
        name: 'pimpinan_tujuan',
        label: 'Tujuan Surat (Pimpinan Instansi)',
        type: 'text',
        placeholder: 'Contoh: Kepala Dinas / Pimpinan Cabang',
        required: true,
      },
      {
        name: 'alamat_instansi',
        label: 'Alamat Lengkap Instansi Tujuan',
        type: 'textarea',
        placeholder: 'Jalan, nomor gedung, kota/kabupaten instansi tujuan',
        required: true,
      },
      {
        name: 'periode_observasi',
        label: 'Periode / Tanggal Observasi',
        type: 'text',
        placeholder: 'Contoh: 1 – 14 Desember 2026',
        required: true,
      },
      {
        name: 'dosen_pengampu',
        label: 'Dosen Pengampu / Pembimbing',
        type: 'text',
        placeholder: 'Contoh: Drs. Ahmad Fauzi, M.M. (Opsional)',
        required: false,
      },
    ],
    requiredDocuments: [
      {
        id: 'ktm_observasi',
        label: 'Scan Kartu Tanda Mahasiswa (KTM)',
        description: 'Format PDF, JPG, atau PNG.',
        required: true,
      },
      {
        id: 'pengantar_observasi',
        label: 'Surat Pengantar / Persetujuan Dosen atau Prodi (Opsional)',
        description: 'Jika diminta oleh dosen pengampu mata kuliah atau program studi.',
        required: false,
      },
    ],
    defaultChecklist: [
      'Identitas mahasiswa sesuai dengan database akademik',
      'Jenis observasi (individu/kelompok) dan daftar anggota kelompok terverifikasi',
      'Nama instansi, pimpinan tujuan, dan topik observasi tertulis lengkap',
      'Scan Kartu Tanda Mahasiswa (KTM) terbaca jelas',
    ],
  },
  {
    id: 'PINDAH_KULIAH',
    code: 'SP-PK',
    title: 'Surat Permohonan Pindah Kuliah',
    shortTitle: 'Pindah Kuliah',
    category: 'Status Akademik',
    description:
      'Alur 3 langkah: (1) Isi formulir dan unduh 3 berkas persyaratan untuk ditandatangani & distempel, (2) Unggah kembali 3 berkas yang telah lengkap, (3) Unduh file PDF Surat Pindah resmi setelah seluruh berkas disetujui untuk diproses staf.',
    estimatedDays: '3–5 Hari Kerja',
    letterSubject: 'SURAT KETERANGAN PINDAH KULIAH',
    formFields: [
      {
        name: 'jenjang',
        label: 'Jenjang Pendidikan',
        type: 'select',
        placeholder: 'Pilih jenjang',
        required: true,
        options: ['SARJANA (S1)', 'DIPLOMA (D3)', 'MAGISTER (S2)'],
        autoFillFrom: 'jenjang',
      },
      {
        name: 'kampus_tujuan',
        label: 'Perguruan Tinggi Tujuan',
        type: 'text',
        placeholder: 'Contoh: Universitas Mulawarman / Universitas Borneo Tarakan',
        required: true,
      },
      {
        name: 'fakultas_prodi_tujuan',
        label: 'Fakultas / Program Studi Tujuan',
        type: 'text',
        placeholder: 'Contoh: Fakultas Ekonomi dan Bisnis / Manajemen',
        required: true,
      },
      {
        name: 'semester_terakhir',
        label: 'Semester Terakhir Ditempuh',
        type: 'text',
        placeholder: 'Contoh: Semester IV (Genap 2025/2026)',
        required: true,
      },
      {
        name: 'jumlah_sks',
        label: 'Jumlah SKS Ditempuh',
        type: 'text',
        placeholder: 'Contoh: 84 SKS',
        required: true,
      },
      {
        name: 'tahun_akademik',
        label: 'Tahun Akademik',
        type: 'text',
        placeholder: 'Contoh: 2026/2027',
        required: true,
      },
      {
        name: 'alasan_pindah',
        label: 'Alasan Pindah Kuliah',
        type: 'textarea',
        placeholder: 'Contoh: Mengikuti kepindahan domisili/tugas orang tua',
        required: true,
      },
    ],
    requiredDocuments: [
      {
        id: 'surat_permohonan_pindah',
        label: '1. Surat Permohonan Pindah Kuliah',
        description:
          'Unduh berkas, isi lengkap, lalu ditandatangani oleh Pemohon dan Orang Tua/Wali sebelum diunggah kembali.',
        required: true,
        templateUrl: '/assets/aistudio/1_Surat_Permohonan_Pindah_788c9beb.pdf',
        templateFileName: '1_Surat_Permohonan_Pindah.pdf',
      },
      {
        id: 'pernyataan_mengundurkan_diri',
        label: '2. Surat Pernyataan Mengundurkan Diri',
        description:
          'Unduh berkas, isi identitas, tempel materai, dan tanda tangani sebelum diunggah kembali.',
        required: true,
        templateUrl: '/assets/aistudio/2_Pernyataan_mengundurkan_diri_8c52dfb6.pdf',
        templateFileName: '2_Pernyataan_Mengundurkan_Diri.pdf',
      },
      {
        id: 'kartu_kontrol_pindah',
        label: '3. Kartu Kontrol Pindah Jurusan / Perguruan Tinggi',
        description:
          'Unduh berkas, lengkapi tanda tangan & stempel petugas B.A.U, Perpustakaan, dan BAK Fakultas sebelum diunggah kembali.',
        required: true,
        templateUrl: '/assets/aistudio/3_Kartu_Kontrol_Pindah_c9c49533.pdf',
        templateFileName: '3_Kartu_Kontrol_Pindah.pdf',
      },
    ],
    defaultChecklist: [
      '1. Surat Permohonan Pindah Kuliah sudah ditandatangani Pemohon & Orang Tua/Wali',
      '2. Surat Pernyataan Mengundurkan Diri bermeterai dan bertanda tangan lengkap',
      '3. Kartu Kontrol Pindah sudah ditandatangani & distempel B.A.U, Perpustakaan, dan BAK Fakultas',
      '4. Berkas Surat Pindah manual (PDF) sudah dibuat dan diunggah untuk mahasiswa',
    ],
  },
];

export function getLetterService(
  id: string,
  servicesList: LetterServiceDefinition[] = LETTER_SERVICES
): LetterServiceDefinition | undefined {
  return servicesList.find((s) => s.id === id) || LETTER_SERVICES.find((s) => s.id === id);
}

export function formatMulaiStudiText(student?: Partial<StudentRecord> | null): string {
  const rawAngkatan = String(student?.angkatan || '').trim();
  const fourDigitMatch =
    rawAngkatan.match(/(\d{4})/) || String(student?.nim || '').trim().match(/^(\d{4})/);
  const startYear = fourDigitMatch ? Number(fourDigitMatch[1]) : NaN;
  if (!Number.isFinite(startYear) || startYear < 1990 || startYear > 2100) {
    return '';
  }
  return `Semester ganjil Tahun Akademik ${startYear} / ${startYear + 1}`;
}

export function resolveFormFieldInitialValue(
  field: FormFieldDef,
  student?: Partial<StudentRecord> | null
): string {
  const defaultVal = typeof field.defaultValue === 'string' ? field.defaultValue.trim() : '';
  const autoVal =
    field.autoFillFrom && student && student[field.autoFillFrom]
      ? String(student[field.autoFillFrom]).trim()
      : '';

  if (field.type === 'select' && field.locked) {
    if (defaultVal) return defaultVal;
    if (autoVal) return autoVal;
    if (field.name === 'jenjang') return 'SARJANA (S1)';
    if (field.options && field.options.length > 0 && !field.autoFillFrom) {
      return field.options[0];
    }
    return '';
  }

  if (autoVal) return autoVal;
  if (field.name === 'mulai_studi') {
    const autoMulai = formatMulaiStudiText(student);
    if (autoMulai) return autoMulai;
  }
  if (defaultVal) return defaultVal;
  if (field.name === 'jenjang') return 'SARJANA (S1)';
  return '';
}

export const ROMAN_MONTHS = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
] as const;

export function getRomanMonth(dateInput?: string | Date | null): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = Number.isNaN(d.getTime()) ? new Date() : d;
  return ROMAN_MONTHS[validDate.getMonth()] || 'I';
}

export interface StaffAccount {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role_title: string;
  is_active: boolean;
  is_primary: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StaffNotificationLog {
  id: string;
  recipient_email: string;
  subject: string;
  body: string;
  request_tracking_code: string;
  status: string;
  created_at: string;
}

export interface BackupSummary {
  format: string;
  version: number;
  exportedAt: string;
  exportedBy: string;
  counts: {
    students: number;
    letterRequests: number;
    requestDocuments: number;
    importLogs: number;
    settings: number;
    uploadFiles: number;
    signatureFiles: number;
    staffAccounts?: number;
  };
}

