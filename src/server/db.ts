import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_LETTER_SETTINGS,
  LETTER_SERVICES,
  getRomanMonth,
  type LetterRequest,
  type LetterServiceDefinition,
  type LetterTemplateSettings,
  type LetterTypeId,
  type RequestStatus,
  type StudentRecord,
  type UploadedDocument,
  type VerificationChecklistItem,
} from '../shared/types.ts';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOAD_DIR = path.resolve(DATA_DIR, 'uploads');
export const SIGNATURE_DIR = path.resolve(DATA_DIR, 'signatures');
const DB_PATH = path.resolve(DATA_DIR, 'portal_surat.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SIGNATURE_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS students (
    nim TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    prodi TEXT NOT NULL,
    fakultas TEXT NOT NULL,
    angkatan TEXT NOT NULL DEFAULT '2023',
    semester INTEGER NOT NULL DEFAULT 1,
    ipk TEXT NOT NULL DEFAULT '0.00',
    email TEXT NOT NULL DEFAULT '',
    no_hp TEXT NOT NULL DEFAULT '',
    tempat_lahir TEXT NOT NULL DEFAULT '',
    tanggal_lahir TEXT NOT NULL DEFAULT '',
    jenis_kelamin TEXT NOT NULL DEFAULT '',
    nik TEXT NOT NULL DEFAULT '',
    jenjang TEXT NOT NULL DEFAULT 'SARJANA (S1)',
    alamat TEXT NOT NULL DEFAULT '',
    status_akademik TEXT NOT NULL DEFAULT 'Aktif',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS import_logs (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    total_rows INTEGER NOT NULL,
    inserted_count INTEGER NOT NULL,
    updated_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL,
    imported_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS letter_requests (
    id TEXT PRIMARY KEY,
    tracking_code TEXT UNIQUE NOT NULL,
    student_nim TEXT NOT NULL,
    letter_type TEXT NOT NULL,
    status TEXT NOT NULL,
    form_data_json TEXT NOT NULL,
    verification_notes TEXT NOT NULL DEFAULT '',
    verified_by TEXT NOT NULL DEFAULT '',
    verified_at TEXT,
    official_number TEXT NOT NULL DEFAULT '',
    signatory_name TEXT NOT NULL DEFAULT 'Dewi Qomariah Imelda, SE., MM.Ak',
    signatory_nidn TEXT NOT NULL DEFAULT '11.050573.02',
    signatory_title TEXT NOT NULL DEFAULT 'Dekan Fakultas Ekonomi Universitas Kaltara',
    signatory_nik TEXT NOT NULL DEFAULT '1973.2009.01.08',
    checklist_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (student_nim) REFERENCES students(nim) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS request_documents (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    FOREIGN KEY (request_id) REFERENCES letter_requests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS staff_users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT 'admin@unikaltar.ac.id',
    role_title TEXT NOT NULL DEFAULT 'Staf Administrasi Akademik',
    passcode_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_notification_logs (
    id TEXT PRIMARY KEY,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    request_tracking_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SENT',
    created_at TEXT NOT NULL
  );
`);

function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('students', 'jenis_kelamin', "TEXT NOT NULL DEFAULT ''");
ensureColumn('students', 'nik', "TEXT NOT NULL DEFAULT ''");
ensureColumn('students', 'jenjang', "TEXT NOT NULL DEFAULT 'SARJANA (S1)'");
ensureColumn('staff_users', 'email', "TEXT NOT NULL DEFAULT 'admin@unikaltar.ac.id'");
ensureColumn('letter_requests', 'signatory_nidn', "TEXT NOT NULL DEFAULT '11.050573.02'");
ensureColumn('letter_requests', 'signatory_nik', "TEXT NOT NULL DEFAULT '1973.2009.01.08'");
ensureColumn('letter_requests', 'manual_pdf_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('letter_requests', 'manual_pdf_stored_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('letter_requests', 'manual_pdf_size', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('letter_requests', 'manual_pdf_uploaded_at', 'TEXT');

function createSamplePngBuffer(label: string, nim: string): Buffer {
  // Minimal valid 1x1 PNG or SVG? Wait: for preview & safety, store a crisp SVG-free real PDF!
  // Let's generate a minimal valid single-page PDF containing readable text for seeded sample attachments.
  const safeText = (s: string) => s.replace(/[()\\]/g, '');
  const contentStream = `BT\n/F1 16 Tf\n50 750 Td\n(${safeText(label)}) Tj\n0 -28 Td\n/F1 11 Tf\n(Nomor Induk Mahasiswa: ${safeText(nim)}) Tj\n0 -20 Td\n(Dokumen lampiran contoh hasil unggahan mahasiswa.) Tj\nET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function seedInitialDataIfEmpty() {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM students').get() as { total: number };
  const logRow = db.prepare('SELECT COUNT(*) as total FROM import_logs').get() as { total: number };
  if (countRow.total > 0 || logRow.total > 0) return;

  const now = new Date().toISOString();
  const initialStudents: Omit<StudentRecord, 'updated_at'>[] = [
    {
      nim: '202541012',
      nama: 'TRI DIAH CAHYA AYU PRATIWI',
      prodi: 'MANAJEMEN',
      fakultas: 'Fakultas Ekonomi',
      angkatan: '2025',
      semester: 3,
      ipk: '3.78',
      email: 'tri.diah@unikaltar.ac.id',
      no_hp: '081234567890',
      tempat_lahir: 'TARAKAN',
      tanggal_lahir: '2005-04-07',
      jenis_kelamin: 'Perempuan',
      nik: '6404094704050002',
      jenjang: 'SARJANA (S1)',
      alamat: 'Jln. BELUAN, SESAYAP HILIR',
      status_akademik: 'Aktif',
    },
    {
      nim: '220411100101',
      nama: 'Siti Rahmawati',
      prodi: 'MANAJEMEN',
      fakultas: 'Fakultas Ekonomi',
      angkatan: '2022',
      semester: 7,
      ipk: '3.82',
      email: 'siti.rahmawati@unikaltar.ac.id',
      no_hp: '081234567801',
      tempat_lahir: 'Tanjung Selor',
      tanggal_lahir: '2004-03-14',
      jenis_kelamin: 'Perempuan',
      nik: '6501055403040001',
      jenjang: 'SARJANA (S1)',
      alamat: 'Jl. Sengkawit No. 42, Tanjung Selor',
      status_akademik: 'Aktif',
    },
    {
      nim: '210411100045',
      nama: 'Ahmad Fauzi Pratama',
      prodi: 'AKUNTANSI',
      fakultas: 'Fakultas Ekonomi',
      angkatan: '2021',
      semester: 8,
      ipk: '3.69',
      email: 'ahmad.fauzi@unikaltar.ac.id',
      no_hp: '081298765432',
      tempat_lahir: 'Tarakan',
      tanggal_lahir: '2003-08-21',
      jenis_kelamin: 'Laki-laki',
      nik: '6571012108030003',
      jenjang: 'SARJANA (S1)',
      alamat: 'Jl. Skip II No. 18, Tanjung Selor',
      status_akademik: 'Aktif',
    },
    {
      nim: '230211100088',
      nama: 'Nadia Kusuma Wardani',
      prodi: 'AKUNTANSI',
      fakultas: 'Fakultas Ekonomi',
      angkatan: '2023',
      semester: 5,
      ipk: '3.91',
      email: 'nadia.kusuma@unikaltar.ac.id',
      no_hp: '085611223344',
      tempat_lahir: 'Bulungan',
      tanggal_lahir: '2005-01-19',
      jenis_kelamin: 'Perempuan',
      nik: '6501025901050002',
      jenjang: 'SARJANA (S1)',
      alamat: 'Jl. Kolonel Soetadji No. 15, Tanjung Selor',
      status_akademik: 'Aktif',
    },
    {
      nim: '220311100019',
      nama: 'Dimas Arya Saputra',
      prodi: 'EKONOMI PEMBANGUNAN',
      fakultas: 'Fakultas Ekonomi',
      angkatan: '2022',
      semester: 7,
      ipk: '3.54',
      email: 'dimas.arya@unikaltar.ac.id',
      no_hp: '081344556677',
      tempat_lahir: 'Malinau',
      tanggal_lahir: '2004-11-02',
      jenis_kelamin: 'Laki-laki',
      nik: '6502040211040001',
      jenjang: 'SARJANA (S1)',
      alamat: 'Jl. Sabanar Lama No. 29, Tanjung Selor',
      status_akademik: 'Aktif',
    },
    {
      nim: '240411100112',
      nama: 'Putri Ayu Lestari',
      prodi: 'MANAJEMEN',
      fakultas: 'Fakultas Ekonomi',
      angkatan: '2024',
      semester: 3,
      ipk: '3.76',
      email: 'putri.ayu@unikaltar.ac.id',
      no_hp: '082177889900',
      tempat_lahir: 'Nunukan',
      tanggal_lahir: '2006-05-09',
      jenis_kelamin: 'Perempuan',
      nik: '6503014905060004',
      jenjang: 'SARJANA (S1)',
      alamat: 'Jl. Pahlawan No. 14, Tanjung Selor',
      status_akademik: 'Aktif',
    },
    {
      nim: '210211100033',
      nama: 'Rizky Maulana Hakim',
      prodi: 'MANAJEMEN',
      fakultas: 'Fakultas Ekonomi',
      angkatan: '2021',
      semester: 8,
      ipk: '3.85',
      email: 'rizky.maulana@unikaltar.ac.id',
      no_hp: '081900112233',
      tempat_lahir: 'Tanjung Redeb',
      tanggal_lahir: '2003-02-27',
      jenis_kelamin: 'Laki-laki',
      nik: '6403052702030001',
      jenjang: 'SARJANA (S1)',
      alamat: 'Jl. Agathis No. 73, Tanjung Selor',
      status_akademik: 'Lulus',
    },
  ];

  const insertStudent = db.prepare(`
    INSERT INTO students (
      nim, nama, prodi, fakultas, angkatan, semester, ipk, email, no_hp,
      tempat_lahir, tanggal_lahir, jenis_kelamin, nik, jenjang, alamat, status_akademik, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSeed = db.transaction(() => {
    for (const s of initialStudents) {
      insertStudent.run(
        s.nim,
        s.nama,
        s.prodi,
        s.fakultas,
        s.angkatan,
        s.semester,
        s.ipk,
        s.email,
        s.no_hp,
        s.tempat_lahir,
        s.tanggal_lahir,
        s.jenis_kelamin,
        s.nik,
        s.jenjang,
        s.alamat,
        s.status_akademik,
        now
      );
    }

    // Create 2 sample requests so staff & students immediately see realistic workflow states
    const req1Id = crypto.randomUUID();
    const req2Id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO letter_requests (
        id, tracking_code, student_nim, letter_type, status, form_data_json,
        verification_notes, verified_by, verified_at, official_number,
        signatory_name, signatory_nidn, signatory_title, signatory_nik, checklist_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req1Id,
      'REG-2026-0001',
      '220411100101',
      'MAGANG_PKL',
      'Menunggu Verifikasi',
      JSON.stringify({
        nama_instansi: 'PT Bank Pembangunan Daerah Kaltimtara Cabang Tanjung Selor',
        jabatan_penerima: 'Pimpinan Cabang / Bagian SDM',
        alamat_instansi: 'Jl. Katamso No. 10, Tanjung Selor, Kalimantan Utara',
        tanggal_mulai: '2027-01-04',
        tanggal_selesai: '2027-03-31',
        bidang_magang: 'Manajemen Pemasaran & Layanan Perbankan',
      }),
      '',
      '',
      null,
      '',
      'Dewi Qomariah Imelda, SE., MM.Ak',
      '11.050573.02',
      'Dekan Fakultas Ekonomi Universitas Kaltara',
      '1973.2009.01.08',
      JSON.stringify([
        { id: 'c1', label: 'Mahasiswa memenuhi syarat semester dan status akademik aktif', checked: false },
        { id: 'c2', label: 'Nama dan alamat instansi tujuan tertulis lengkap', checked: false },
        { id: 'c3', label: 'Transkrip nilai sementara dan persetujuan koordinator PKL terlampir', checked: false },
      ]),
      now,
      now
    );

    db.prepare(`
      INSERT INTO letter_requests (
        id, tracking_code, student_nim, letter_type, status, form_data_json,
        verification_notes, verified_by, verified_at, official_number,
        signatory_name, signatory_nidn, signatory_title, signatory_nik, checklist_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req2Id,
      'REG-2026-0002',
      '202541012',
      'AKTIF_KULIAH',
      'Disetujui',
      JSON.stringify({
        nik: '6404094704050002',
        tempat_lahir: 'TARAKAN',
        tanggal_lahir: '2005-04-07',
        jenis_kelamin: 'Perempuan',
        jenjang: 'SARJANA (S1)',
        mulai_studi: 'Semester ganjil Tahun Akademik 2025 / 2026',
        alamat: 'Jln. BELUAN, SESAYAP HILIR',
        keperluan: 'persyaratan pengurusan BPJS Kesehatan',
      }),
      'Seluruh data identitas, NIK, NPM, dan bukti pembayaran UKT semester berjalan telah terverifikasi valid.',
      'Staf Administrasi Akademik',
      now,
      '110/FE.UNIKALTAR/YAPETAS/X/2026',
      'Dewi Qomariah Imelda, SE., MM.Ak',
      '11.050573.02',
      'Dekan Fakultas Ekonomi Universitas Kaltara',
      '1973.2009.01.08',
      JSON.stringify([
        { id: 'c1', label: 'Identitas NPM, NIK, dan status aktif mahasiswa sesuai database Excel', checked: true },
        { id: 'c2', label: 'Tempat/tanggal lahir, jenis kelamin, dan alamat sesuai identitas', checked: true },
        { id: 'c3', label: 'Bukti pembayaran UKT atau KRS semester berjalan valid', checked: true },
      ]),
      now,
      now
    );

    // Write real PDF documents for the seeded requests
    const docs = [
      {
        requestId: req1Id,
        docType: 'Transkrip Nilai Sementara',
        originalName: 'Transkrip_Sementara_220411100101.pdf',
        label: 'Transkrip Nilai Sementara - Siti Rahmawati',
        nim: '220411100101',
      },
      {
        requestId: req1Id,
        docType: 'Proposal Singkat / Persetujuan Koordinator PKL',
        originalName: 'Persetujuan_PKL_220411100101.pdf',
        label: 'Persetujuan Koordinator PKL - Siti Rahmawati',
        nim: '220411100101',
      },
      {
        requestId: req2Id,
        docType: 'Scan Kartu Tanda Mahasiswa (KTM)',
        originalName: 'KTM_Siti_Rahmawati.pdf',
        label: 'Kartu Tanda Mahasiswa - Siti Rahmawati',
        nim: '220411100101',
      },
    ];

    const insertDoc = db.prepare(`
      INSERT INTO request_documents (
        id, request_id, doc_type, original_name, mime_type, size_bytes, stored_name, uploaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const d of docs) {
      const storedName = `${crypto.randomUUID()}.pdf`;
      const pdfBuf = createSamplePngBuffer(d.label, d.nim);
      fs.writeFileSync(path.join(UPLOAD_DIR, storedName), pdfBuf);
      insertDoc.run(
        crypto.randomUUID(),
        d.requestId,
        d.docType,
        d.originalName,
        'application/pdf',
        pdfBuf.byteLength,
        storedName,
        now
      );
    }
  });

  insertSeed();
}

seedInitialDataIfEmpty();

export function syncLegacyStaffAccountIfNeeded() {
  const staffCountRow = db
    .prepare('SELECT COUNT(*) as total FROM staff_users')
    .get() as { total: number };
  if (staffCountRow.total > 0) return;

  const hashRow = db
    .prepare("SELECT value, updated_at FROM settings WHERE key = 'staff_passcode_hash'")
    .get() as { value: string; updated_at: string } | undefined;
  if (!hashRow?.value) return;

  const nameRow = db
    .prepare("SELECT value FROM settings WHERE key = 'staff_display_name'")
    .get() as { value: string } | undefined;
  const fullName = nameRow?.value?.trim() || 'Staf Administrasi Akademik';
  const now = hashRow.updated_at || new Date().toISOString();

  db.prepare(`
    INSERT OR IGNORE INTO staff_users (
      id, username, full_name, role_title, passcode_hash, is_active, is_primary,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'primary-admin',
    'admin',
    fullName,
    'Admin Utama',
    hashRow.value,
    1,
    1,
    'Sistem',
    now,
    now
  );
}

syncLegacyStaffAccountIfNeeded();

export function getLetterTemplateSettings(): LetterTemplateSettings {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'letter_template_settings'")
    .get() as { value: string } | undefined;

  if (!row?.value) {
    return { ...DEFAULT_LETTER_SETTINGS };
  }
  try {
    const parsed = JSON.parse(row.value) as Partial<LetterTemplateSettings>;
    return {
      signatory_name:
        typeof parsed.signatory_name === 'string' && parsed.signatory_name.trim()
          ? parsed.signatory_name.trim()
          : DEFAULT_LETTER_SETTINGS.signatory_name,
      signatory_nidn:
        typeof parsed.signatory_nidn === 'string' && parsed.signatory_nidn.trim()
          ? parsed.signatory_nidn.trim()
          : DEFAULT_LETTER_SETTINGS.signatory_nidn,
      signatory_title:
        typeof parsed.signatory_title === 'string' && parsed.signatory_title.trim()
          ? parsed.signatory_title.trim()
          : DEFAULT_LETTER_SETTINGS.signatory_title,
      signatory_role_heading:
        typeof parsed.signatory_role_heading === 'string' && parsed.signatory_role_heading.trim()
          ? parsed.signatory_role_heading.trim()
          : DEFAULT_LETTER_SETTINGS.signatory_role_heading,
      signatory_nik:
        typeof parsed.signatory_nik === 'string' && parsed.signatory_nik.trim()
          ? parsed.signatory_nik.trim()
          : DEFAULT_LETTER_SETTINGS.signatory_nik,
      letter_city:
        typeof parsed.letter_city === 'string' && parsed.letter_city.trim()
          ? parsed.letter_city.trim()
          : DEFAULT_LETTER_SETTINGS.letter_city,
      institution_foundation:
        typeof parsed.institution_foundation === 'string' && parsed.institution_foundation.trim()
          ? parsed.institution_foundation.trim()
          : DEFAULT_LETTER_SETTINGS.institution_foundation,
      institution_university:
        typeof parsed.institution_university === 'string' && parsed.institution_university.trim()
          ? parsed.institution_university.trim()
          : DEFAULT_LETTER_SETTINGS.institution_university,
      institution_faculty:
        typeof parsed.institution_faculty === 'string' && parsed.institution_faculty.trim()
          ? parsed.institution_faculty.trim()
          : DEFAULT_LETTER_SETTINGS.institution_faculty,
      institution_address:
        typeof parsed.institution_address === 'string' && parsed.institution_address.trim()
          ? parsed.institution_address.trim()
          : DEFAULT_LETTER_SETTINGS.institution_address,
      number_middle_code:
        typeof parsed.number_middle_code === 'string' && parsed.number_middle_code.trim()
          ? parsed.number_middle_code.trim()
          : DEFAULT_LETTER_SETTINGS.number_middle_code,
      aktif_kuliah_signature_enabled:
        typeof parsed.aktif_kuliah_signature_enabled === 'boolean'
          ? parsed.aktif_kuliah_signature_enabled
          : DEFAULT_LETTER_SETTINGS.aktif_kuliah_signature_enabled,
      aktif_kuliah_signature_url:
        typeof parsed.aktif_kuliah_signature_url === 'string' &&
        parsed.aktif_kuliah_signature_url.trim()
          ? parsed.aktif_kuliah_signature_url.trim()
          : DEFAULT_LETTER_SETTINGS.aktif_kuliah_signature_url,
      aktif_kuliah_stamp_enabled:
        typeof parsed.aktif_kuliah_stamp_enabled === 'boolean'
          ? parsed.aktif_kuliah_stamp_enabled
          : DEFAULT_LETTER_SETTINGS.aktif_kuliah_stamp_enabled,
      aktif_kuliah_stamp_url:
        typeof parsed.aktif_kuliah_stamp_url === 'string' &&
        parsed.aktif_kuliah_stamp_url.trim()
          ? parsed.aktif_kuliah_stamp_url.trim()
          : DEFAULT_LETTER_SETTINGS.aktif_kuliah_stamp_url,
    };
  } catch {
    return { ...DEFAULT_LETTER_SETTINGS };
  }
}

export function saveLetterTemplateSettings(next: LetterTemplateSettings): LetterTemplateSettings {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('letter_template_settings', ?, ?)"
  ).run(JSON.stringify(next), now);
  return next;
}

export function getConfiguredLetterServices(): LetterServiceDefinition[] {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'letter_services_config'")
    .get() as { value: string } | undefined;

  if (!row?.value) {
    return LETTER_SERVICES;
  }

  try {
    const parsed = JSON.parse(row.value) as Record<string, LetterServiceDefinition>;
    if (!parsed || typeof parsed !== 'object') return LETTER_SERVICES;
    return LETTER_SERVICES.map((base) => {
      const override = parsed[base.id];
      if (!override || override.id !== base.id) return base;
      const mergedDocs = Array.isArray(override.requiredDocuments)
        ? override.requiredDocuments.map((doc) => {
            const baseDoc = base.requiredDocuments.find((bd) => bd.id === doc.id);
            if (!baseDoc) return doc;
            return {
              ...doc,
              templateUrl: doc.templateUrl || baseDoc.templateUrl,
              templateFileName: doc.templateFileName || baseDoc.templateFileName,
            };
          })
        : base.requiredDocuments;

      return {
        ...base,
        ...override,
        id: base.id,
        code: base.code,
        formFields: Array.isArray(override.formFields) ? override.formFields : base.formFields,
        requiredDocuments: mergedDocs,
        defaultChecklist: Array.isArray(override.defaultChecklist)
          ? override.defaultChecklist
          : base.defaultChecklist,
      };
    });
  } catch {
    return LETTER_SERVICES;
  }
}

export function getConfiguredLetterService(id: string): LetterServiceDefinition | undefined {
  return getConfiguredLetterServices().find((s) => s.id === id);
}

export function saveConfiguredLetterService(
  updatedService: LetterServiceDefinition
): LetterServiceDefinition[] {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'letter_services_config'")
    .get() as { value: string } | undefined;

  let overrides: Record<string, LetterServiceDefinition> = {};
  if (row?.value) {
    try {
      overrides = JSON.parse(row.value) as Record<string, LetterServiceDefinition>;
    } catch {
      overrides = {};
    }
  }

  overrides[updatedService.id] = updatedService;
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('letter_services_config', ?, ?)"
  ).run(JSON.stringify(overrides), now);

  return getConfiguredLetterServices();
}

export function resetConfiguredLetterService(id: LetterTypeId): LetterServiceDefinition[] {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'letter_services_config'")
    .get() as { value: string } | undefined;

  if (!row?.value) return LETTER_SERVICES;

  let overrides: Record<string, LetterServiceDefinition> = {};
  try {
    overrides = JSON.parse(row.value) as Record<string, LetterServiceDefinition>;
  } catch {
    overrides = {};
  }

  delete overrides[id];
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('letter_services_config', ?, ?)"
  ).run(JSON.stringify(overrides), now);

  return getConfiguredLetterServices();
}

export function mapRequestRow(row: Record<string, unknown>): LetterRequest {
  const id = String(row.id);
  const studentRow = db
    .prepare('SELECT * FROM students WHERE nim = ?')
    .get(String(row.student_nim)) as StudentRecord | undefined;

  const docRows = db
    .prepare('SELECT * FROM request_documents WHERE request_id = ? ORDER BY uploaded_at ASC')
    .all(id) as UploadedDocument[];

  const defaults = getLetterTemplateSettings();

  let formData: Record<string, string> = {};
  let checklist: VerificationChecklistItem[] = [];
  try {
    formData = JSON.parse(String(row.form_data_json || '{}'));
  } catch {
    formData = {};
  }
  try {
    checklist = JSON.parse(String(row.checklist_json || '[]'));
  } catch {
    checklist = [];
  }

  return {
    id,
    tracking_code: String(row.tracking_code),
    student_nim: String(row.student_nim),
    letter_type: String(row.letter_type) as LetterTypeId,
    status: String(row.status) as RequestStatus,
    form_data: formData,
    verification_notes: String(row.verification_notes || ''),
    verified_by: String(row.verified_by || ''),
    verified_at: row.verified_at ? String(row.verified_at) : null,
    official_number: String(row.official_number || ''),
    signatory_name: String(row.signatory_name || defaults.signatory_name),
    signatory_nidn: String(row.signatory_nidn || defaults.signatory_nidn),
    signatory_title: String(row.signatory_title || defaults.signatory_title),
    signatory_nik: String(row.signatory_nik || defaults.signatory_nik),
    checklist,
    manual_pdf_name: String(row.manual_pdf_name || ''),
    manual_pdf_size: Number(row.manual_pdf_size || 0),
    manual_pdf_uploaded_at: row.manual_pdf_uploaded_at ? String(row.manual_pdf_uploaded_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    student: studentRow,
    documents: docRows,
  };
}

export function generateNextTrackingCode(): string {
  const year = new Date().getFullYear();
  const prefix = `REG-${year}-`;
  const rows = db
    .prepare('SELECT tracking_code FROM letter_requests WHERE tracking_code LIKE ?')
    .all(`${prefix}%`) as { tracking_code: string }[];

  let maxSeq = 0;
  for (const r of rows) {
    const raw = String(r.tracking_code || '').trim();
    const match = raw.match(/^REG-\d{4}-(\d+)$/);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }

  let seq = maxSeq + 1;
  let candidate = `${prefix}${String(seq).padStart(4, '0')}`;
  const checkStmt = db.prepare('SELECT 1 FROM letter_requests WHERE tracking_code = ?');
  while (checkStmt.get(candidate)) {
    seq++;
    candidate = `${prefix}${String(seq).padStart(4, '0')}`;
  }
  return candidate;
}

export function generateNextOfficialNumber(
  _letterCode?: string,
  referenceDate?: string | Date | null
): string {
  const targetDate = referenceDate ? new Date(referenceDate) : new Date();
  const validDate = Number.isNaN(targetDate.getTime()) ? new Date() : targetDate;
  const targetYear = validDate.getFullYear();
  const roman = getRomanMonth(validDate);
  const settings = getLetterTemplateSettings();
  const middle = settings.number_middle_code || 'FE.UNIKALTAR/YAPETAS';

  const rows = db
    .prepare(
      "SELECT official_number, verified_at, created_at FROM letter_requests WHERE TRIM(COALESCE(official_number, '')) != ''"
    )
    .all() as { official_number: string; verified_at: string | null; created_at: string }[];

  let maxSeq = 0;
  for (const row of rows) {
    const rawNum = String(row.official_number || '').trim();
    const seqMatch = rawNum.match(/^(\d+)\s*\//);
    if (!seqMatch) continue;

    const yearMatch = rawNum.match(/\/(\d{4})\s*$/);
    let rowYear: number | null = yearMatch ? Number(yearMatch[1]) : null;
    if (!rowYear) {
      const d = new Date(row.verified_at || row.created_at);
      if (!Number.isNaN(d.getTime())) {
        rowYear = d.getFullYear();
      }
    }

    if (rowYear === targetYear) {
      const parsed = Number.parseInt(seqMatch[1], 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }

  const nextSeq = maxSeq > 0 ? maxSeq + 1 : 1;
  return `${String(nextSeq).padStart(3, '0')}/${middle}/${roman}/${targetYear}`;
}
