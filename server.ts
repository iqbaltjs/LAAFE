import 'dotenv/config';
import ExcelJS from 'exceljs';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import {
  SIGNATURE_DIR,
  UPLOAD_DIR,
  db,
  generateNextOfficialNumber,
  generateNextTrackingCode,
  getConfiguredLetterService,
  getConfiguredLetterServices,
  getLetterTemplateSettings,
  mapRequestRow,
  resetConfiguredLetterService,
  saveConfiguredLetterService,
  saveLetterTemplateSettings,
  syncLegacyStaffAccountIfNeeded,
} from './src/server/db.ts';
import {
  DEFAULT_DEAN_SIGNATURE_URL,
  DEFAULT_DEAN_STAMP_URL,
  LETTER_SERVICES,
  formatMulaiStudiText,
  resolveFormFieldInitialValue,
  type ActiveCohortStat,
  type ActiveStudentStatsSummary,
  type BackupSummary,
  type FormFieldDef,
  type LetterServiceDefinition,
  type LetterTemplateSettings,
  type LetterTypeId,
  type RequestStatus,
  type RequiredDocumentDef,
  type StaffAccount,
  type StudentCompletenessStats,
  type StudentRecord,
  type UserRole,
} from './src/shared/types.ts';

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

interface AuthPayload {
  role: UserRole;
  nim?: string;
  staffId?: string;
  staffUsername?: string;
  staffName?: string;
  exp: number;
}

interface AuthedRequest extends Request {
  auth?: AuthPayload;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

function signToken(payload: Omit<AuthPayload, 'exp'>): string {
  const fullPayload: AuthPayload = {
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = base64UrlEncode(JSON.stringify(fullPayload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest();
  return `${encoded}.${base64UrlEncode(sig)}`;
}

function verifyToken(token: string): AuthPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sigPart] = parts;
  if (!encoded || !sigPart) return null;

  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest();
  let actualSig: Buffer;
  try {
    actualSig = base64UrlDecode(sigPart);
  } catch {
    return null;
  }
  if (actualSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(actualSig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(encoded).toString('utf8')) as AuthPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPasscodeHash(passcode: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  try {
    const derived = crypto.scryptSync(passcode, salt, 64);
    const expected = Buffer.from(hexHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function timingSafeTextMatch(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function extractBearer(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim() || null;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Sesi tidak ditemukan. Silakan masuk kembali.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sesi telah kedaluwarsa atau tidak valid.' });
    return;
  }
  req.auth = payload;
  next();
}

function requireStaff(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.auth?.role !== 'staff') {
      res.status(403).json({ error: 'Akses ditolak. Khusus Staf Administrasi.' });
      return;
    }
    if (req.auth.staffId && req.auth.staffId !== 'env-admin') {
      const account = db
        .prepare('SELECT id, username, full_name, is_active FROM staff_users WHERE id = ?')
        .get(req.auth.staffId) as
        | { id: string; username: string; full_name: string; is_active: number }
        | undefined;
      if (!account || !account.is_active) {
        res.status(401).json({
          error: 'Akun staf Anda sudah dinonaktifkan atau tidak ditemukan. Silakan masuk kembali.',
        });
        return;
      }
      req.auth.staffName = account.full_name;
      req.auth.staffUsername = account.username;
    }
    next();
  });
}

function requireStudent(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.auth?.role !== 'student' || !req.auth.nim) {
      res.status(403).json({ error: 'Akses ditolak. Khusus Mahasiswa terdaftar.' });
      return;
    }
    next();
  });
}

function getStaffAuthStatus(): {
  configured: boolean;
  source: 'env' | 'claimed' | 'unclaimed';
  hasStaffAccounts: boolean;
  staffCount: number;
} {
  const activeCountRow = db
    .prepare('SELECT COUNT(*) as total FROM staff_users WHERE is_active = 1')
    .get() as { total: number };
  const staffCount = Number(activeCountRow?.total || 0);
  const hasStaffAccounts = staffCount > 0;

  const envPass = (process.env.ADMIN_PASSCODE || '').trim();
  if (envPass.length > 0) {
    return { configured: true, source: 'env', hasStaffAccounts, staffCount };
  }
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'staff_passcode_hash'")
    .get() as { value: string } | undefined;
  if ((row && row.value) || hasStaffAccounts) {
    return { configured: true, source: 'claimed', hasStaffAccounts, staffCount };
  }
  return { configured: false, source: 'unclaimed', hasStaffAccounts: false, staffCount: 0 };
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pickField(row: Record<string, unknown>, candidates: string[]): string {
  const normalizedEntries = Object.entries(row).map(([k, v]) => [normalizeHeader(k), v] as const);
  for (const cand of candidates) {
    const found = normalizedEntries.find(([key]) => key === cand);
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') {
      return String(found[1]).trim();
    }
  }
  return '';
}

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
});

const manualPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

const ALLOWED_DOC_MIMES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
};

function isValidPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
}

function isValidDocBuffer(buf: Buffer, mimetype: string): boolean {
  if (mimetype === 'application/pdf') return isValidPdfBuffer(buf);
  if (mimetype === 'image/png') {
    return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  return false;
}

const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});

const ALLOWED_SIGNATURE_MIMES: Record<string, { ext: string; mime: string }> = {
  'image/png': { ext: '.png', mime: 'image/png' },
  'image/jpeg': { ext: '.jpg', mime: 'image/jpeg' },
  'image/jpg': { ext: '.jpg', mime: 'image/jpeg' },
  'image/webp': { ext: '.webp', mime: 'image/webp' },
};

const BACKUP_FORMAT_ID = 'fe-unikaltar-portal-backup';
const BACKUP_VERSION = 1;

interface FullBackupPayload {
  format: string;
  version: number;
  exportedAt: string;
  exportedBy: string;
  tables: {
    settings: Record<string, unknown>[];
    students: Record<string, unknown>[];
    import_logs: Record<string, unknown>[];
    letter_requests: Record<string, unknown>[];
    request_documents: Record<string, unknown>[];
    staff_users?: Record<string, unknown>[];
  };
  files: {
    uploads: Record<string, string>;
    signatures: Record<string, string>;
  };
}

function collectDirectoryFilesBase64(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(dir)) return result;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const safeName = path.basename(entry.name);
    if (!/^[a-zA-Z0-9._-]+$/.test(safeName) || safeName === '.' || safeName === '..') {
      continue;
    }
    const resolved = path.resolve(dir, safeName);
    if (!resolved.startsWith(dir + path.sep)) continue;
    result[safeName] = fs.readFileSync(resolved).toString('base64');
  }
  return result;
}

function countDirectoryRegularFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[a-zA-Z0-9._-]+$/.test(entry.name)).length;
}

function buildFullBackupPayload(exportedBy: string): FullBackupPayload {
  const snapshot = db.transaction(() => {
    const settings = db
      .prepare('SELECT key, value, updated_at FROM settings ORDER BY key ASC')
      .all() as Record<string, unknown>[];
    const students = db
      .prepare(`
        SELECT nim, nama, prodi, fakultas, angkatan, semester, ipk, email, no_hp,
               tempat_lahir, tanggal_lahir, jenis_kelamin, nik, jenjang, alamat,
               status_akademik, updated_at
        FROM students
        ORDER BY nim ASC
      `)
      .all() as Record<string, unknown>[];
    const import_logs = db
      .prepare(`
        SELECT id, filename, total_rows, inserted_count, updated_count, skipped_count,
               imported_by, created_at
        FROM import_logs
        ORDER BY created_at ASC
      `)
      .all() as Record<string, unknown>[];
    const letter_requests = db
      .prepare(`
        SELECT id, tracking_code, student_nim, letter_type, status, form_data_json,
               verification_notes, verified_by, verified_at, official_number,
               signatory_name, signatory_nidn, signatory_title, signatory_nik,
               checklist_json, manual_pdf_name, manual_pdf_stored_name, manual_pdf_size,
               manual_pdf_uploaded_at, created_at, updated_at
        FROM letter_requests
        ORDER BY created_at ASC
      `)
      .all() as Record<string, unknown>[];
    const request_documents = db
      .prepare(`
        SELECT id, request_id, doc_type, original_name, mime_type, size_bytes,
               stored_name, uploaded_at
        FROM request_documents
        ORDER BY uploaded_at ASC
      `)
      .all() as Record<string, unknown>[];
    const staff_users = db
      .prepare(`
        SELECT id, username, full_name, role_title, passcode_hash, is_active, is_primary,
               created_by, created_at, updated_at
        FROM staff_users
        ORDER BY is_primary DESC, created_at ASC
      `)
      .all() as Record<string, unknown>[];

    return {
      settings,
      students,
      import_logs,
      letter_requests,
      request_documents,
      staff_users,
    };
  })();

  const uploads = collectDirectoryFilesBase64(UPLOAD_DIR);
  const signatures = collectDirectoryFilesBase64(SIGNATURE_DIR);

  return {
    format: BACKUP_FORMAT_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy,
    tables: snapshot,
    files: {
      uploads,
      signatures,
    },
  };
}

function decodeSafeFileMap(
  rawMap: unknown,
  targetDir: string,
  label: string
): { name: string; resolvedPath: string; buffer: Buffer }[] {
  if (rawMap === undefined || rawMap === null) return [];
  if (typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    throw new Error(`Struktur file ${label} dalam cadangan tidak valid.`);
  }
  const decoded: { name: string; resolvedPath: string; buffer: Buffer }[] = [];
  for (const [rawName, rawB64] of Object.entries(rawMap as Record<string, unknown>)) {
    const safeName = path.basename(rawName);
    if (
      safeName !== rawName ||
      safeName === '.' ||
      safeName === '..' ||
      !/^[a-zA-Z0-9._-]+$/.test(safeName)
    ) {
      throw new Error(`Nama file tidak valid pada ${label}: ${rawName}`);
    }
    const resolvedPath = path.resolve(targetDir, safeName);
    if (!resolvedPath.startsWith(targetDir + path.sep)) {
      throw new Error(`Jalur file ditolak pada ${label}: ${rawName}`);
    }
    if (typeof rawB64 !== 'string') {
      throw new Error(`Isi file ${safeName} tidak valid.`);
    }
    decoded.push({
      name: safeName,
      resolvedPath,
      buffer: Buffer.from(rawB64, 'base64'),
    });
  }
  return decoded;
}

function parseAndValidateBackupBuffer(rawBuffer: Buffer): {
  payload: FullBackupPayload;
  summary: BackupSummary;
  uploadEntries: { name: string; resolvedPath: string; buffer: Buffer }[];
  signatureEntries: { name: string; resolvedPath: string; buffer: Buffer }[];
} {
  if (!rawBuffer || rawBuffer.length === 0) {
    throw new Error('File cadangan kosong.');
  }

  let jsonText: string;
  try {
    const isGzip = rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b;
    const textBuf = isGzip
      ? zlib.gunzipSync(rawBuffer, { maxOutputLength: 200 * 1024 * 1024 })
      : rawBuffer;
    jsonText = textBuf.toString('utf8');
  } catch {
    throw new Error('File cadangan tidak dapat dibaca atau rusak (bukan format .fe-backup.gz / JSON yang valid).');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Isi file cadangan bukan format JSON cadangan sistem yang valid.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Struktur file cadangan tidak valid.');
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.format !== BACKUP_FORMAT_ID || obj.version !== BACKUP_VERSION) {
    throw new Error('File ini bukan file cadangan resmi Portal Layanan Surat FE Universitas Kaltara.');
  }

  const tables = obj.tables as Record<string, unknown> | undefined;
  if (
    !tables ||
    typeof tables !== 'object' ||
    !Array.isArray(tables.settings) ||
    !Array.isArray(tables.students) ||
    !Array.isArray(tables.import_logs) ||
    !Array.isArray(tables.letter_requests) ||
    !Array.isArray(tables.request_documents)
  ) {
    throw new Error('Struktur tabel data dan pengaturan di dalam file cadangan tidak lengkap.');
  }

  const filesObj = (obj.files || {}) as Record<string, unknown>;
  const uploadEntries = decodeSafeFileMap(filesObj.uploads, UPLOAD_DIR, 'lampiran dokumen');
  const signatureEntries = decodeSafeFileMap(
    filesObj.signatures,
    SIGNATURE_DIR,
    'tanda tangan dan stempel'
  );

  const staffUsersList = Array.isArray(tables.staff_users)
    ? (tables.staff_users as Record<string, unknown>[])
    : [];

  const summary: BackupSummary = {
    format: String(obj.format),
    version: Number(obj.version),
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    exportedBy:
      typeof obj.exportedBy === 'string' && obj.exportedBy.trim()
        ? obj.exportedBy.trim()
        : 'Staf Administrasi',
    counts: {
      students: tables.students.length,
      letterRequests: tables.letter_requests.length,
      requestDocuments: tables.request_documents.length,
      importLogs: tables.import_logs.length,
      settings: tables.settings.length,
      uploadFiles: uploadEntries.length,
      signatureFiles: signatureEntries.length,
      staffAccounts: staffUsersList.length,
    },
  };

  return {
    payload: obj as unknown as FullBackupPayload,
    summary,
    uploadEntries,
    signatureEntries,
  };
}

const ALLOWED_STATUSES: RequestStatus[] = [
  'Menunggu Berkas',
  'Menunggu Verifikasi',
  'Sedang Diproses',
  'Perlu Revisi',
  'Disetujui',
  'Ditolak',
];

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Service Catalog & Template Settings
  app.get('/api/services', (_req, res) => {
    res.json({
      services: getConfiguredLetterServices(),
      templateSettings: getLetterTemplateSettings(),
    });
  });

  // Staff: Update Official Letter Template Settings (Dekan, NIDN, NIK, Kop Surat)
  app.put('/api/staff/template-settings', requireStaff, (req, res) => {
    const body = req.body || {};
    const current = getLetterTemplateSettings();

    const cleanStr = (val: unknown, fallback: string, maxLen = 200): string => {
      if (typeof val !== 'string') return fallback;
      const trimmed = val.trim().slice(0, maxLen);
      return trimmed || fallback;
    };

    const rawSignatureUrl =
      typeof body.aktif_kuliah_signature_url === 'string'
        ? body.aktif_kuliah_signature_url.trim()
        : current.aktif_kuliah_signature_url;
    const isAllowedSigUrl =
      rawSignatureUrl === DEFAULT_DEAN_SIGNATURE_URL ||
      /^\/api\/public\/signature\/(sig|stamp)_[a-f0-9-]+\.(png|jpg|webp)$/.test(rawSignatureUrl);

    const rawStampUrl =
      typeof body.aktif_kuliah_stamp_url === 'string'
        ? body.aktif_kuliah_stamp_url.trim()
        : current.aktif_kuliah_stamp_url;
    const isAllowedStampUrl =
      rawStampUrl === DEFAULT_DEAN_STAMP_URL ||
      /^\/api\/public\/signature\/(sig|stamp)_[a-f0-9-]+\.(png|jpg|webp)$/.test(rawStampUrl);

    const nextSettings: LetterTemplateSettings = {
      signatory_name: cleanStr(body.signatory_name, current.signatory_name, 140),
      signatory_nidn: cleanStr(body.signatory_nidn, current.signatory_nidn, 60),
      signatory_title: cleanStr(body.signatory_title, current.signatory_title, 160),
      signatory_role_heading: cleanStr(
        body.signatory_role_heading,
        current.signatory_role_heading,
        80
      ),
      signatory_nik: cleanStr(body.signatory_nik, current.signatory_nik, 60),
      letter_city: cleanStr(body.letter_city, current.letter_city, 80),
      institution_foundation: cleanStr(
        body.institution_foundation,
        current.institution_foundation,
        160
      ),
      institution_university: cleanStr(
        body.institution_university,
        current.institution_university,
        160
      ),
      institution_faculty: cleanStr(body.institution_faculty, current.institution_faculty, 160),
      institution_address: cleanStr(body.institution_address, current.institution_address, 260),
      number_middle_code: cleanStr(body.number_middle_code, current.number_middle_code, 80),
      aktif_kuliah_signature_enabled:
        typeof body.aktif_kuliah_signature_enabled === 'boolean'
          ? body.aktif_kuliah_signature_enabled
          : current.aktif_kuliah_signature_enabled,
      aktif_kuliah_signature_url: isAllowedSigUrl
        ? rawSignatureUrl
        : current.aktif_kuliah_signature_url || DEFAULT_DEAN_SIGNATURE_URL,
      aktif_kuliah_stamp_enabled:
        typeof body.aktif_kuliah_stamp_enabled === 'boolean'
          ? body.aktif_kuliah_stamp_enabled
          : current.aktif_kuliah_stamp_enabled,
      aktif_kuliah_stamp_url: isAllowedStampUrl
        ? rawStampUrl
        : current.aktif_kuliah_stamp_url || DEFAULT_DEAN_STAMP_URL,
    };

    if (!nextSettings.signatory_name || !nextSettings.signatory_nidn || !nextSettings.signatory_nik) {
      res.status(400).json({ error: 'Nama Dekan, NIDN, dan NIK wajib diisi.' });
      return;
    }

    const saved = saveLetterTemplateSettings(nextSettings);

    if (body.applyToExisting === true) {
      db.prepare(`
        UPDATE letter_requests
        SET signatory_name = ?, signatory_nidn = ?, signatory_title = ?, signatory_nik = ?
      `).run(
        saved.signatory_name,
        saved.signatory_nidn,
        saved.signatory_title,
        saved.signatory_nik
      );
    } else {
      db.prepare(`
        UPDATE letter_requests
        SET signatory_name = ?, signatory_nidn = ?, signatory_title = ?, signatory_nik = ?
        WHERE status IN ('Menunggu Verifikasi', 'Sedang Diproses', 'Perlu Revisi')
      `).run(
        saved.signatory_name,
        saved.signatory_nidn,
        saved.signatory_title,
        saved.signatory_nik
      );
    }

    res.json({ templateSettings: saved });
  });

  // Staff: Upload Official Signature Image File (PNG/JPG/WEBP)
  app.post('/api/staff/signature', requireStaff, signatureUpload.single('signature'), (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Pilih file gambar tanda tangan (PNG, JPG, atau WEBP).' });
      return;
    }

    const mimeMeta = ALLOWED_SIGNATURE_MIMES[file.mimetype];
    if (!mimeMeta) {
      res.status(400).json({ error: 'Format file tanda tangan harus berupa PNG, JPG, atau WEBP.' });
      return;
    }

    // Verify magic bytes match image signature
    const buf = file.buffer;
    const isPng =
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47;
    const isJpg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isWebp =
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!isPng && !isJpg && !isWebp) {
      res.status(400).json({ error: 'Isi file tidak valid sebagai gambar PNG, JPG, atau WEBP.' });
      return;
    }

    const filename = `sig_${crypto.randomUUID()}${mimeMeta.ext}`;
    const targetPath = path.join(SIGNATURE_DIR, filename);
    fs.writeFileSync(targetPath, buf);

    const url = `/api/public/signature/${filename}`;
    const current = getLetterTemplateSettings();
    const saved = saveLetterTemplateSettings({
      ...current,
      aktif_kuliah_signature_enabled: true,
      aktif_kuliah_signature_url: url,
    });

    res.json({ url, templateSettings: saved });
  });

  // Staff: Upload Official Stamp Image File (PNG/JPG/WEBP)
  app.post('/api/staff/stamp', requireStaff, signatureUpload.single('stamp'), (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Pilih file gambar stempel (PNG, JPG, atau WEBP).' });
      return;
    }

    const mimeMeta = ALLOWED_SIGNATURE_MIMES[file.mimetype];
    if (!mimeMeta) {
      res.status(400).json({ error: 'Format file stempel harus berupa PNG, JPG, atau WEBP.' });
      return;
    }

    const buf = file.buffer;
    const isPng =
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47;
    const isJpg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isWebp =
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!isPng && !isJpg && !isWebp) {
      res.status(400).json({ error: 'Isi file tidak valid sebagai gambar PNG, JPG, atau WEBP.' });
      return;
    }

    const filename = `stamp_${crypto.randomUUID()}${mimeMeta.ext}`;
    const targetPath = path.join(SIGNATURE_DIR, filename);
    fs.writeFileSync(targetPath, buf);

    const url = `/api/public/signature/${filename}`;
    const current = getLetterTemplateSettings();
    const saved = saveLetterTemplateSettings({
      ...current,
      aktif_kuliah_stamp_enabled: true,
      aktif_kuliah_stamp_url: url,
    });

    res.json({ url, templateSettings: saved });
  });

  // Public serve uploaded official signature / stamp image (strictly validated filename)
  app.get('/api/public/signature/:filename', (req, res) => {
    const filename = path.basename(String(req.params.filename || '').trim());
    if (!/^(sig|stamp)_[a-f0-9-]+\.(png|jpg|webp)$/.test(filename)) {
      res.status(404).end();
      return;
    }

    const targetPath = path.resolve(SIGNATURE_DIR, filename);
    if (!targetPath.startsWith(SIGNATURE_DIR + path.sep) || !fs.existsSync(targetPath)) {
      res.status(404).end();
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(targetPath).pipe(res);
  });

  // Staff: Update Letter Service Form Definition
  app.put('/api/staff/services/:id', requireStaff, (req, res) => {
    const id = String(req.params.id || '').trim() as LetterTypeId;
    const base = LETTER_SERVICES.find((s) => s.id === id);
    if (!base) {
      res.status(404).json({ error: 'Jenis layanan surat tidak ditemukan.' });
      return;
    }

    const body = req.body || {};
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : base.title;
    const shortTitle =
      typeof body.shortTitle === 'string' && body.shortTitle.trim()
        ? body.shortTitle.trim()
        : base.shortTitle;
    const category =
      typeof body.category === 'string' && body.category.trim()
        ? body.category.trim()
        : base.category;
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : base.description;
    const estimatedDays =
      typeof body.estimatedDays === 'string' && body.estimatedDays.trim()
        ? body.estimatedDays.trim()
        : base.estimatedDays;
    const letterSubject =
      typeof body.letterSubject === 'string' && body.letterSubject.trim()
        ? body.letterSubject.trim()
        : base.letterSubject;

    const allowedTypes = new Set(['text', 'textarea', 'date', 'select']);
    const rawFields = Array.isArray(body.formFields) ? body.formFields : base.formFields;
    const formFields: FormFieldDef[] = [];
    const seenNames = new Set<string>();

    for (let i = 0; i < rawFields.length; i++) {
      const f = rawFields[i] as Record<string, unknown>;
      const label = typeof f?.label === 'string' ? f.label.trim() : '';
      if (!label) continue;
      let name = typeof f?.name === 'string' ? normalizeHeader(f.name) : '';
      if (!name) name = normalizeHeader(label) || `kolom_${i + 1}`;
      if (seenNames.has(name)) name = `${name}_${i + 1}`;
      seenNames.add(name);

      const typeStr = typeof f?.type === 'string' ? f.type.trim() : 'text';
      const fieldType = (allowedTypes.has(typeStr) ? typeStr : 'text') as FormFieldDef['type'];
      const placeholder = typeof f?.placeholder === 'string' ? f.placeholder.trim() : '';
      const required = Boolean(f?.required);
      const options =
        fieldType === 'select' && Array.isArray(f?.options)
          ? f.options.map((o) => String(o).trim()).filter(Boolean)
          : undefined;
      const locked = fieldType === 'select' ? Boolean(f?.locked) : false;
      const rawDefaultValue =
        fieldType === 'select' && typeof f?.defaultValue === 'string'
          ? f.defaultValue.trim()
          : '';
      const defaultValue =
        rawDefaultValue && (!options || options.length === 0 || options.includes(rawDefaultValue))
          ? rawDefaultValue
          : '';
      const baseField = base.formFields.find((bf) => bf.name === name);
      const autoFillFrom =
        typeof f?.autoFillFrom === 'string' && f.autoFillFrom.trim()
          ? (f.autoFillFrom.trim() as keyof StudentRecord)
          : baseField?.autoFillFrom;

      formFields.push({
        name,
        label,
        type: fieldType,
        placeholder,
        required,
        ...(options && options.length > 0 ? { options } : {}),
        ...(autoFillFrom ? { autoFillFrom } : {}),
        ...(locked ? { locked: true } : {}),
        ...(defaultValue ? { defaultValue } : {}),
      });
    }

    if (formFields.length === 0) {
      res.status(400).json({ error: 'Minimal harus terdapat satu kolom formulir.' });
      return;
    }

    const rawDocs = Array.isArray(body.requiredDocuments)
      ? body.requiredDocuments
      : base.requiredDocuments;
    const requiredDocuments: RequiredDocumentDef[] = [];
    for (let i = 0; i < rawDocs.length; i++) {
      const d = rawDocs[i] as Record<string, unknown>;
      const label = typeof d?.label === 'string' ? d.label.trim() : '';
      if (!label) continue;
      const docId =
        typeof d?.id === 'string' && d.id.trim()
          ? normalizeHeader(d.id)
          : normalizeHeader(label) || `dok_${i + 1}`;
      const baseDoc = base.requiredDocuments.find((bd) => bd.id === docId);
      requiredDocuments.push({
        id: docId,
        label,
        description:
          typeof d?.description === 'string' && d.description.trim()
            ? d.description.trim()
            : 'Format PDF, JPG, atau PNG.',
        required: Boolean(d?.required),
        ...(baseDoc?.templateUrl ? { templateUrl: baseDoc.templateUrl } : {}),
        ...(baseDoc?.templateFileName ? { templateFileName: baseDoc.templateFileName } : {}),
      });
    }

    const rawChecklist = Array.isArray(body.defaultChecklist)
      ? body.defaultChecklist
      : base.defaultChecklist;
    const defaultChecklist = rawChecklist
      .map((item: unknown) => String(item || '').trim())
      .filter(Boolean);

    const updatedService: LetterServiceDefinition = {
      id: base.id,
      code: base.code,
      title,
      shortTitle,
      category,
      description,
      estimatedDays,
      letterSubject,
      formFields,
      requiredDocuments: Array.isArray(body.requiredDocuments)
        ? requiredDocuments
        : base.requiredDocuments,
      defaultChecklist:
        defaultChecklist.length > 0 ? defaultChecklist : base.defaultChecklist,
    };

    const services = saveConfiguredLetterService(updatedService);
    res.json({ services, service: updatedService });
  });

  // Staff: Reset Letter Service Form Definition to Default
  app.post('/api/staff/services/:id/reset', requireStaff, (req, res) => {
    const id = String(req.params.id || '').trim() as LetterTypeId;
    const base = LETTER_SERVICES.find((s) => s.id === id);
    if (!base) {
      res.status(404).json({ error: 'Jenis layanan surat tidak ditemukan.' });
      return;
    }
    const services = resetConfiguredLetterService(id);
    res.json({ services, service: base });
  });

  // Staff: Current Data & Settings Summary for Local Backup
  app.get('/api/staff/backup/summary', requireStaff, (req: AuthedRequest, res) => {
    const countsRow = db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM students) AS students,
          (SELECT COUNT(*) FROM letter_requests) AS letterRequests,
          (SELECT COUNT(*) FROM request_documents) AS requestDocuments,
          (SELECT COUNT(*) FROM import_logs) AS importLogs,
          (SELECT COUNT(*) FROM settings) AS settings,
          (SELECT COUNT(*) FROM staff_users) AS staffAccounts
      `)
      .get() as {
      students: number;
      letterRequests: number;
      requestDocuments: number;
      importLogs: number;
      settings: number;
      staffAccounts: number;
    };

    const summary: BackupSummary = {
      format: BACKUP_FORMAT_ID,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: req.auth?.staffName || 'Staf Administrasi',
      counts: {
        students: Number(countsRow.students || 0),
        letterRequests: Number(countsRow.letterRequests || 0),
        requestDocuments: Number(countsRow.requestDocuments || 0),
        importLogs: Number(countsRow.importLogs || 0),
        settings: Number(countsRow.settings || 0),
        uploadFiles: countDirectoryRegularFiles(UPLOAD_DIR),
        signatureFiles: countDirectoryRegularFiles(SIGNATURE_DIR),
        staffAccounts: Number(countsRow.staffAccounts || 0),
      },
    };
    res.json({ summary });
  });

  // Staff: Export Full Database, Settings & Uploaded Files to Local Hard Drive (.fe-backup.gz)
  app.get('/api/staff/backup/export', requireStaff, (req: AuthedRequest, res) => {
    try {
      const payload = buildFullBackupPayload(req.auth?.staffName || 'Staf Administrasi');
      const jsonBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
      const gzBuffer = zlib.gzipSync(jsonBuffer, { level: 6 });

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateTag = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
        now.getHours()
      )}${pad(now.getMinutes())}`;
      const filename = `cadangan-data-setting-fe-unikaltar-${dateTag}.fe-backup.gz`;

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(gzBuffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal membuat file cadangan data.',
      });
    }
  });

  // Staff: Inspect Backup File Before Restore
  app.post('/api/staff/backup/inspect', requireStaff, (req, res) => {
    backupUpload.single('backup')(req, res, (uploadErr) => {
      if (uploadErr) {
        const msg =
          uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE'
            ? 'Ukuran file cadangan melebihi batas maksimal 100 MB.'
            : uploadErr.message || 'Gagal membaca file cadangan.';
        res.status(400).json({ error: msg });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'Pilih file cadangan dari hardisk lokal terlebih dahulu.' });
        return;
      }

      try {
        const { summary } = parseAndValidateBackupBuffer(req.file.buffer);
        res.json({ summary });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'File cadangan tidak valid.',
        });
      }
    });
  });

  // Staff: Restore Full Database, Settings & Files from Uploaded Backup File
  app.post('/api/staff/backup/restore', requireStaff, (req, res) => {
    backupUpload.single('backup')(req, res, (uploadErr) => {
      if (uploadErr) {
        const msg =
          uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE'
            ? 'Ukuran file cadangan melebihi batas maksimal 100 MB.'
            : uploadErr.message || 'Gagal mengunggah file cadangan.';
        res.status(400).json({ error: msg });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'Pilih file cadangan dari hardisk lokal terlebih dahulu.' });
        return;
      }

      try {
        const { payload, summary, uploadEntries, signatureEntries } =
          parseAndValidateBackupBuffer(req.file.buffer);

        const nowIso = new Date().toISOString();
        const existingStaffPasscode = db
          .prepare("SELECT value, updated_at FROM settings WHERE key = 'staff_passcode_hash'")
          .get() as { value: string; updated_at: string } | undefined;

        const restoreTx = db.transaction(() => {
          db.prepare('DELETE FROM request_documents').run();
          db.prepare('DELETE FROM letter_requests').run();
          db.prepare('DELETE FROM import_logs').run();
          db.prepare('DELETE FROM students').run();
          db.prepare('DELETE FROM settings').run();

          const insertSetting = db.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
          `);
          let hasStaffPasscodeInBackup = false;
          for (const row of payload.tables.settings) {
            const key = typeof row.key === 'string' ? row.key.trim() : '';
            if (!key) continue;
            if (key === 'staff_passcode_hash') {
              hasStaffPasscodeInBackup = true;
            }
            const value = typeof row.value === 'string' ? row.value : JSON.stringify(row.value ?? '');
            const updatedAt =
              typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : nowIso;
            insertSetting.run(key, value, updatedAt);
          }
          if (!hasStaffPasscodeInBackup && existingStaffPasscode?.value) {
            insertSetting.run(
              'staff_passcode_hash',
              existingStaffPasscode.value,
              existingStaffPasscode.updated_at || nowIso
            );
          }

          const insertStudent = db.prepare(`
            INSERT INTO students (
              nim, nama, prodi, fakultas, angkatan, semester, ipk, email, no_hp,
              tempat_lahir, tanggal_lahir, jenis_kelamin, nik, jenjang, alamat,
              status_akademik, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const row of payload.tables.students) {
            const nim = typeof row.nim === 'string' ? row.nim.trim() : String(row.nim || '').trim();
            if (!nim) {
              throw new Error('Terdapat baris mahasiswa tanpa NIM pada file cadangan.');
            }
            insertStudent.run(
              nim,
              String(row.nama || ''),
              String(row.prodi || 'MANAJEMEN'),
              String(row.fakultas || 'Fakultas Ekonomi'),
              String(row.angkatan || ''),
              Number.isFinite(Number(row.semester)) ? Number(row.semester) : 1,
              String(row.ipk || '0.00'),
              String(row.email || ''),
              String(row.no_hp || ''),
              String(row.tempat_lahir || ''),
              String(row.tanggal_lahir || ''),
              String(row.jenis_kelamin || ''),
              String(row.nik || ''),
              String(row.jenjang || 'SARJANA (S1)'),
              String(row.alamat || ''),
              String(row.status_akademik || 'Aktif'),
              typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : nowIso
            );
          }

          const insertImportLog = db.prepare(`
            INSERT INTO import_logs (
              id, filename, total_rows, inserted_count, updated_count, skipped_count,
              imported_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const row of payload.tables.import_logs) {
            const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : crypto.randomUUID();
            insertImportLog.run(
              id,
              String(row.filename || 'import.xlsx'),
              Number(row.total_rows || 0),
              Number(row.inserted_count || 0),
              Number(row.updated_count || 0),
              Number(row.skipped_count || 0),
              String(row.imported_by || 'Staf Administrasi'),
              typeof row.created_at === 'string' && row.created_at ? row.created_at : nowIso
            );
          }

          const insertRequest = db.prepare(`
            INSERT INTO letter_requests (
              id, tracking_code, student_nim, letter_type, status, form_data_json,
              verification_notes, verified_by, verified_at, official_number,
              signatory_name, signatory_nidn, signatory_title, signatory_nik,
              checklist_json, manual_pdf_name, manual_pdf_stored_name, manual_pdf_size,
              manual_pdf_uploaded_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const row of payload.tables.letter_requests) {
            const id = typeof row.id === 'string' ? row.id.trim() : '';
            const trackingCode = typeof row.tracking_code === 'string' ? row.tracking_code.trim() : '';
            const studentNim = typeof row.student_nim === 'string' ? row.student_nim.trim() : '';
            if (!id || !trackingCode || !studentNim) {
              throw new Error('Terdapat pengajuan surat dengan data kunci tidak lengkap pada file cadangan.');
            }
            insertRequest.run(
              id,
              trackingCode,
              studentNim,
              String(row.letter_type || 'AKTIF_KULIAH'),
              String(row.status || 'Menunggu Verifikasi'),
              typeof row.form_data_json === 'string'
                ? row.form_data_json
                : JSON.stringify(row.form_data_json ?? {}),
              String(row.verification_notes || ''),
              String(row.verified_by || ''),
              typeof row.verified_at === 'string' && row.verified_at ? row.verified_at : null,
              String(row.official_number || ''),
              String(row.signatory_name || 'Dewi Qomariah Imelda, SE., MM.Ak'),
              String(row.signatory_nidn || '11.050573.02'),
              String(row.signatory_title || 'Dekan Fakultas Ekonomi Universitas Kaltara'),
              String(row.signatory_nik || '1973.2009.01.08'),
              typeof row.checklist_json === 'string'
                ? row.checklist_json
                : JSON.stringify(row.checklist_json ?? []),
              String(row.manual_pdf_name || ''),
              String(row.manual_pdf_stored_name || ''),
              Number(row.manual_pdf_size || 0),
              typeof row.manual_pdf_uploaded_at === 'string' && row.manual_pdf_uploaded_at
                ? row.manual_pdf_uploaded_at
                : null,
              typeof row.created_at === 'string' && row.created_at ? row.created_at : nowIso,
              typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : nowIso
            );
          }

          const insertDoc = db.prepare(`
            INSERT INTO request_documents (
              id, request_id, doc_type, original_name, mime_type, size_bytes,
              stored_name, uploaded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const row of payload.tables.request_documents) {
            const id = typeof row.id === 'string' ? row.id.trim() : '';
            const requestId = typeof row.request_id === 'string' ? row.request_id.trim() : '';
            const storedName = typeof row.stored_name === 'string' ? row.stored_name.trim() : '';
            if (!id || !requestId || !storedName) {
              throw new Error('Terdapat metadata lampiran tidak lengkap pada file cadangan.');
            }
            insertDoc.run(
              id,
              requestId,
              String(row.doc_type || 'Dokumen Pendukung'),
              String(row.original_name || storedName),
              String(row.mime_type || 'application/octet-stream'),
              Number(row.size_bytes || 0),
              storedName,
              typeof row.uploaded_at === 'string' && row.uploaded_at ? row.uploaded_at : nowIso
            );
          }

          if (Array.isArray(payload.tables.staff_users)) {
            db.prepare('DELETE FROM staff_users').run();
            const insertStaffUser = db.prepare(`
              INSERT INTO staff_users (
                id, username, full_name, role_title, passcode_hash, is_active, is_primary,
                created_by, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const row of payload.tables.staff_users) {
              const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : crypto.randomUUID();
              const username = typeof row.username === 'string' ? row.username.trim().toLowerCase() : '';
              const passcodeHash = typeof row.passcode_hash === 'string' ? row.passcode_hash.trim() : '';
              if (!username || !passcodeHash) continue;
              insertStaffUser.run(
                id,
                username,
                String(row.full_name || 'Staf Administrasi Akademik'),
                String(row.role_title || 'Staf Administrasi Akademik'),
                passcodeHash,
                row.is_active === 0 || row.is_active === false ? 0 : 1,
                row.is_primary === 1 || row.is_primary === true ? 1 : 0,
                String(row.created_by || 'Sistem'),
                typeof row.created_at === 'string' && row.created_at ? row.created_at : nowIso,
                typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : nowIso
              );
            }
          }
        });

        restoreTx();
        syncLegacyStaffAccountIfNeeded();

        // Sync physical upload & signature files strictly after database commit
        const syncDirectory = (
          dir: string,
          entries: { name: string; resolvedPath: string; buffer: Buffer }[]
        ) => {
          fs.mkdirSync(dir, { recursive: true });
          const desired = new Set(entries.map((e) => e.name));
          for (const existing of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!existing.isFile()) continue;
            if (!desired.has(existing.name)) {
              const oldPath = path.resolve(dir, path.basename(existing.name));
              if (oldPath.startsWith(dir + path.sep)) {
                fs.unlinkSync(oldPath);
              }
            }
          }
          for (const entry of entries) {
            fs.writeFileSync(entry.resolvedPath, entry.buffer);
          }
        };

        syncDirectory(UPLOAD_DIR, uploadEntries);
        syncDirectory(SIGNATURE_DIR, signatureEntries);

        res.json({
          summary,
          services: getConfiguredLetterServices(),
          templateSettings: getLetterTemplateSettings(),
        });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Gagal memulihkan data dan pengaturan dari file cadangan.',
        });
      }
    });
  });

  // Auth: Staff Status
  app.get('/api/auth/staff/status', (_req, res) => {
    res.json(getStaffAuthStatus());
  });

  // Public Aggregate Stats (No PII): Active students per cohort for Manajemen & Ekonomi Pembangunan
  app.get('/api/public/active-student-stats', (_req, res) => {
    const rows = db
      .prepare(`
        SELECT
          TRIM(angkatan) AS angkatan,
          SUM(CASE WHEN LOWER(prodi) LIKE '%manajemen%' THEN 1 ELSE 0 END) AS manajemen,
          SUM(CASE WHEN LOWER(prodi) LIKE '%ekonomi pembangunan%' THEN 1 ELSE 0 END) AS ekonomiPembangunan
        FROM students
        WHERE LOWER(TRIM(status_akademik)) = 'aktif'
          AND TRIM(COALESCE(angkatan, '')) != ''
        GROUP BY TRIM(angkatan)
        ORDER BY CAST(TRIM(angkatan) AS INTEGER) DESC, TRIM(angkatan) DESC
      `)
      .all() as { angkatan: string; manajemen: number; ekonomiPembangunan: number }[];

    const cohorts: ActiveCohortStat[] = rows
      .map((r) => {
        const manajemen = Number(r.manajemen || 0);
        const ekonomiPembangunan = Number(r.ekonomiPembangunan || 0);
        return {
          angkatan: String(r.angkatan || '').trim(),
          manajemen,
          ekonomiPembangunan,
          total: manajemen + ekonomiPembangunan,
        };
      })
      .filter((c) => c.total > 0);

    const totalManajemen = cohorts.reduce((acc, c) => acc + c.manajemen, 0);
    const totalEkonomiPembangunan = cohorts.reduce((acc, c) => acc + c.ekonomiPembangunan, 0);

    const payload: ActiveStudentStatsSummary = {
      totalAktif: totalManajemen + totalEkonomiPembangunan,
      totalManajemen,
      totalEkonomiPembangunan,
      cohorts,
    };

    res.json(payload);
  });

  // Auth: One-time first-run claim when ADMIN_PASSCODE env is not set
  app.post('/api/auth/staff/claim', (req, res) => {
    const status = getStaffAuthStatus();
    if (status.configured) {
      res.status(409).json({
        error: 'Kata sandi Staf Administrasi sudah dikonfigurasi dan terkunci.',
      });
      return;
    }

    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    const rawUsername =
      typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const username = rawUsername || 'admin';
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      res.status(400).json({
        error: 'Username staf minimal 3 karakter (hanya huruf kecil, angka, titik, _, atau -).',
      });
      return;
    }

    const staffName =
      typeof req.body?.staffName === 'string' && req.body.staffName.trim()
        ? req.body.staffName.trim().slice(0, 120)
        : 'Staf Administrasi Akademik';
    const staffEmail =
      typeof req.body?.email === 'string' && req.body.email.trim()
        ? req.body.email.trim().slice(0, 140)
        : 'admin@unikaltar.ac.id';

    if (passcode.length < 6) {
      res.status(400).json({ error: 'Kata sandi minimal terdiri dari 6 karakter.' });
      return;
    }

    const hashed = hashPasscode(passcode);
    const now = new Date().toISOString();

    const insertClaim = db.transaction(() => {
      const existing = db
        .prepare("SELECT value FROM settings WHERE key = 'staff_passcode_hash'")
        .get();
      if (existing) return false;
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('staff_passcode_hash', ?, ?)").run(
        hashed,
        now
      );
      db.prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('staff_display_name', ?, ?)"
      ).run(staffName, now);
      db.prepare(`
        INSERT INTO staff_users (
          id, username, full_name, email, role_title, passcode_hash, is_active, is_primary,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('primary-admin', username, staffName, staffEmail, 'Admin Utama', hashed, 1, 1, staffName, now, now);
      return true;
    });

    if (!insertClaim()) {
      res.status(409).json({ error: 'Kata sandi Staf Administrasi sudah pernah diaktivasi.' });
      return;
    }

    const token = signToken({
      role: 'staff',
      staffId: 'primary-admin',
      staffUsername: username,
      staffName,
    });
    res.json({ token, role: 'staff', staffId: 'primary-admin', staffUsername: username, staffName, email: staffEmail });
  });

  // Auth: Staff Login
  app.post('/api/auth/staff/login', (req, res) => {
    const rawUsername =
      typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (!passcode) {
      res.status(400).json({ error: 'Masukkan kata sandi Staf Administrasi.' });
      return;
    }

    const authStatus = getStaffAuthStatus();
    if (!authStatus.configured) {
      res.status(400).json({ error: 'Akun Staf belum diaktivasi. Silakan buat kata sandi awal.' });
      return;
    }

    const envPass = (process.env.ADMIN_PASSCODE || '').trim();

    if (rawUsername) {
      const user = db
        .prepare('SELECT * FROM staff_users WHERE LOWER(username) = ?')
        .get(rawUsername) as
        | {
            id: string;
            username: string;
            full_name: string;
            role_title: string;
            passcode_hash: string;
            is_active: number;
            is_primary: number;
          }
        | undefined;

      if (user) {
        if (!user.is_active) {
          res.status(403).json({
            error: 'Akun staf ini sedang dinonaktifkan. Hubungi admin staf utama.',
          });
          return;
        }
        const matchesEnv =
          user.is_primary === 1 && envPass.length > 0 && timingSafeTextMatch(passcode, envPass);
        const matchesHash = verifyPasscodeHash(passcode, user.passcode_hash);
        if (!matchesEnv && !matchesHash) {
          res.status(401).json({ error: 'Username atau kata sandi Staf Administrasi tidak sesuai.' });
          return;
        }
        const token = signToken({
          role: 'staff',
          staffId: user.id,
          staffUsername: user.username,
          staffName: user.full_name,
        });
        res.json({
          token,
          role: 'staff',
          staffId: user.id,
          staffUsername: user.username,
          staffName: user.full_name,
        });
        return;
      }

      if (rawUsername === 'admin' && envPass.length > 0 && timingSafeTextMatch(passcode, envPass)) {
        const nameRow = db
          .prepare("SELECT value FROM settings WHERE key = 'staff_display_name'")
          .get() as { value: string } | undefined;
        const staffName = nameRow?.value || 'Staf Administrasi Akademik';
        const token = signToken({
          role: 'staff',
          staffId: 'env-admin',
          staffUsername: 'admin',
          staffName,
        });
        res.json({
          token,
          role: 'staff',
          staffId: 'env-admin',
          staffUsername: 'admin',
          staffName,
        });
        return;
      }

      res.status(401).json({ error: 'Username atau kata sandi Staf Administrasi tidak sesuai.' });
      return;
    }

    // No username provided: verify against ADMIN_PASSCODE or legacy primary passcode
    if (envPass.length > 0 && timingSafeTextMatch(passcode, envPass)) {
      const nameRow = db
        .prepare("SELECT value FROM settings WHERE key = 'staff_display_name'")
        .get() as { value: string } | undefined;
      const staffName = nameRow?.value || 'Staf Administrasi Akademik';
      const token = signToken({
        role: 'staff',
        staffId: 'env-admin',
        staffUsername: 'admin',
        staffName,
      });
      res.json({ token, role: 'staff', staffId: 'env-admin', staffUsername: 'admin', staffName });
      return;
    }

    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'staff_passcode_hash'")
      .get() as { value: string } | undefined;
    const primaryUser = db
      .prepare('SELECT id, username, full_name, passcode_hash, is_active FROM staff_users WHERE is_primary = 1')
      .get() as
      | { id: string; username: string; full_name: string; passcode_hash: string; is_active: number }
      | undefined;

    if (primaryUser && primaryUser.is_active && verifyPasscodeHash(passcode, primaryUser.passcode_hash)) {
      const token = signToken({
        role: 'staff',
        staffId: primaryUser.id,
        staffUsername: primaryUser.username,
        staffName: primaryUser.full_name,
      });
      res.json({
        token,
        role: 'staff',
        staffId: primaryUser.id,
        staffUsername: primaryUser.username,
        staffName: primaryUser.full_name,
      });
      return;
    }

    if (row?.value && verifyPasscodeHash(passcode, row.value)) {
      const nameRow = db
        .prepare("SELECT value FROM settings WHERE key = 'staff_display_name'")
        .get() as { value: string } | undefined;
      const staffName = nameRow?.value || 'Staf Administrasi Akademik';
      const token = signToken({
        role: 'staff',
        staffId: primaryUser?.id || 'primary-admin',
        staffUsername: primaryUser?.username || 'admin',
        staffName,
      });
      res.json({
        token,
        role: 'staff',
        staffId: primaryUser?.id || 'primary-admin',
        staffUsername: primaryUser?.username || 'admin',
        staffName,
      });
      return;
    }

    res.status(401).json({
      error: authStatus.hasStaffAccounts
        ? 'Kata sandi utama tidak cocok. Jika menggunakan akun staf tambahan, isi kolom Username Staf.'
        : 'Kata sandi Staf Administrasi tidak sesuai.',
    });
  });

  // Staff Accounts Management (Requires Authenticated Staff)
  app.get('/api/staff/accounts', requireStaff, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(`
        SELECT id, username, full_name, email, role_title, is_active, is_primary,
               created_by, created_at, updated_at
        FROM staff_users
        ORDER BY is_primary DESC, created_at ASC
      `)
      .all() as {
      id: string;
      username: string;
      full_name: string;
      email: string;
      role_title: string;
      is_active: number;
      is_primary: number;
      created_by: string;
      created_at: string;
      updated_at: string;
    }[];

    const accounts: StaffAccount[] = rows.map((r) => ({
      id: r.id,
      username: r.username,
      full_name: r.full_name,
      email: r.email || 'admin@unikaltar.ac.id',
      role_title: r.role_title,
      is_active: Boolean(r.is_active),
      is_primary: Boolean(r.is_primary),
      created_by: r.created_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    res.json({
      accounts,
      currentStaffId: req.auth?.staffId || '',
      currentStaffName: req.auth?.staffName || 'Staf Administrasi Akademik',
      envPasscodeActive: Boolean((process.env.ADMIN_PASSCODE || '').trim()),
    });
  });

  app.post('/api/staff/accounts', requireStaff, (req: AuthedRequest, res) => {
    const rawUsername =
      typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const fullName =
      typeof req.body?.full_name === 'string' ? req.body.full_name.trim().slice(0, 120) : '';
    const email =
      typeof req.body?.email === 'string' && req.body.email.trim()
        ? req.body.email.trim().slice(0, 140)
        : 'admin@unikaltar.ac.id';
    const roleTitle =
      typeof req.body?.role_title === 'string' && req.body.role_title.trim()
        ? req.body.role_title.trim().slice(0, 120)
        : 'Staf Administrasi Akademik';
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';

    if (!fullName) {
      res.status(400).json({ error: 'Nama lengkap staf wajib diisi.' });
      return;
    }
    if (!/^[a-z0-9._-]{3,40}$/.test(rawUsername)) {
      res.status(400).json({
        error:
          'Username staf harus terdiri dari 3–40 karakter (hanya huruf kecil, angka, titik, _, atau -).',
      });
      return;
    }
    if (passcode.length < 6) {
      res.status(400).json({ error: 'Kata sandi staf baru minimal 6 karakter.' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM staff_users WHERE LOWER(username) = ?')
      .get(rawUsername) as { id: string } | undefined;
    if (existing) {
      res.status(409).json({
        error: `Username "${rawUsername}" sudah terdaftar. Gunakan username lain.`,
      });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const hashed = hashPasscode(passcode);
    const createdBy = req.auth?.staffName || 'Staf Administrasi Akademik';

    db.prepare(`
      INSERT INTO staff_users (
        id, username, full_name, email, role_title, passcode_hash, is_active, is_primary,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, rawUsername, fullName, email, roleTitle, hashed, 1, 0, createdBy, now, now);

    const account: StaffAccount = {
      id,
      username: rawUsername,
      full_name: fullName,
      email,
      role_title: roleTitle,
      is_active: true,
      is_primary: false,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    };

    res.status(201).json({ account });
  });

  app.patch('/api/staff/accounts/:id', requireStaff, (req: AuthedRequest, res) => {
    const id = String(req.params.id || '').trim();
    const target = db
      .prepare('SELECT * FROM staff_users WHERE id = ?')
      .get(id) as
      | {
          id: string;
          username: string;
          full_name: string;
          email: string;
          role_title: string;
          passcode_hash: string;
          is_active: number;
          is_primary: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!target) {
      res.status(404).json({ error: 'Akun staf tidak ditemukan.' });
      return;
    }

    const fullName =
      typeof req.body?.full_name === 'string' && req.body.full_name.trim()
        ? req.body.full_name.trim().slice(0, 120)
        : target.full_name;
    const email =
      typeof req.body?.email === 'string' && req.body.email.trim()
        ? req.body.email.trim().slice(0, 140)
        : target.email || 'admin@unikaltar.ac.id';
    const roleTitle =
      typeof req.body?.role_title === 'string' && req.body.role_title.trim()
        ? req.body.role_title.trim().slice(0, 120)
        : target.role_title;
    const nextIsActive =
      typeof req.body?.is_active === 'boolean' ? req.body.is_active : Boolean(target.is_active);
    const newPasscode =
      typeof req.body?.new_passcode === 'string' ? req.body.new_passcode.trim() : '';

    if (!nextIsActive && req.auth?.staffId === target.id) {
      res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun yang sedang digunakan.' });
      return;
    }

    if (!nextIsActive && Boolean(target.is_active)) {
      const envConfigured = Boolean((process.env.ADMIN_PASSCODE || '').trim());
      const activeCountRow = db
        .prepare('SELECT COUNT(*) as total FROM staff_users WHERE is_active = 1')
        .get() as { total: number };
      if (!envConfigured && Number(activeCountRow.total || 0) <= 1) {
        res.status(400).json({
          error: 'Minimal harus terdapat satu akun staf administrasi yang aktif.',
        });
        return;
      }
    }

    if (newPasscode && newPasscode.length < 6) {
      res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
      return;
    }

    const now = new Date().toISOString();
    const nextHash = newPasscode ? hashPasscode(newPasscode) : target.passcode_hash;

    db.transaction(() => {
      db.prepare(`
        UPDATE staff_users
        SET full_name = ?, email = ?, role_title = ?, passcode_hash = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `).run(fullName, email, roleTitle, nextHash, nextIsActive ? 1 : 0, now, id);

      if (target.is_primary === 1) {
        db.prepare(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('staff_display_name', ?, ?)"
        ).run(fullName, now);
        if (newPasscode) {
          db.prepare(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('staff_passcode_hash', ?, ?)"
          ).run(nextHash, now);
        }
      }
    })();

    const account: StaffAccount = {
      id: target.id,
      username: target.username,
      full_name: fullName,
      email,
      role_title: roleTitle,
      is_active: nextIsActive,
      is_primary: Boolean(target.is_primary),
      created_by: target.created_by,
      created_at: target.created_at,
      updated_at: now,
    };

    res.json({ account });
  });

  app.delete('/api/staff/accounts/:id', requireStaff, (req: AuthedRequest, res) => {
    const id = String(req.params.id || '').trim();
    const target = db
      .prepare('SELECT id, is_primary, is_active FROM staff_users WHERE id = ?')
      .get(id) as { id: string; is_primary: number; is_active: number } | undefined;

    if (!target) {
      res.status(404).json({ error: 'Akun staf tidak ditemukan.' });
      return;
    }
    if (target.id === req.auth?.staffId) {
      res.status(400).json({ error: 'Anda tidak dapat menghapus akun yang sedang digunakan.' });
      return;
    }
    if (target.is_primary === 1) {
      res.status(400).json({ error: 'Akun staf utama tidak dapat dihapus.' });
      return;
    }
    const envConfigured = Boolean((process.env.ADMIN_PASSCODE || '').trim());
    const activeCountRow = db
      .prepare('SELECT COUNT(*) as total FROM staff_users WHERE is_active = 1')
      .get() as { total: number };
    if (!envConfigured && target.is_active === 1 && Number(activeCountRow.total || 0) <= 1) {
      res.status(400).json({ error: 'Minimal harus terdapat satu akun staf aktif.' });
      return;
    }

    db.prepare('DELETE FROM staff_users WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // Auth: Student Login with NIM
  app.post('/api/auth/student/login', (req, res) => {
    const nim = typeof req.body?.nim === 'string' ? req.body.nim.trim() : '';
    if (!nim) {
      res.status(400).json({ error: 'Masukkan Nomor Induk Mahasiswa (NIM) Anda.' });
      return;
    }

    const student = db
      .prepare('SELECT * FROM students WHERE nim = ?')
      .get(nim) as StudentRecord | undefined;

    if (!student) {
      res.status(404).json({
        error:
          'NIM tidak ditemukan dalam database mahasiswa. Pastikan data mahasiswa telah diunggah melalui Excel oleh Staf Administrasi.',
      });
      return;
    }

    const token = signToken({ role: 'student', nim: student.nim });
    res.json({ token, role: 'student', student });
  });

  // Auth: Current Session Profile
  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    if (req.auth?.role === 'staff') {
      if (req.auth.staffId && req.auth.staffId !== 'env-admin') {
        const account = db
          .prepare('SELECT id, username, full_name, is_active FROM staff_users WHERE id = ?')
          .get(req.auth.staffId) as
          | { id: string; username: string; full_name: string; is_active: number }
          | undefined;
        if (!account || !account.is_active) {
          res.status(401).json({ error: 'Akun staf tidak aktif atau tidak ditemukan.' });
          return;
        }
        res.json({
          role: 'staff',
          staffId: account.id,
          staffUsername: account.username,
          staffName: account.full_name,
        });
        return;
      }
      res.json({
        role: 'staff',
        staffId: req.auth.staffId || 'env-admin',
        staffUsername: req.auth.staffUsername || 'admin',
        staffName: req.auth.staffName || 'Staf Administrasi Akademik',
      });
      return;
    }
    if (req.auth?.role === 'student' && req.auth.nim) {
      const student = db
        .prepare('SELECT * FROM students WHERE nim = ?')
        .get(req.auth.nim) as StudentRecord | undefined;
      if (!student) {
        res.status(404).json({ error: 'Data mahasiswa tidak ditemukan.' });
        return;
      }
      res.json({ role: 'student', student });
      return;
    }
    res.status(401).json({ error: 'Sesi tidak valid.' });
  });

  const INCOMPLETE_SQL_CONDITION = `
    (TRIM(COALESCE(nik, '')) = ''
     OR TRIM(COALESCE(tempat_lahir, '')) = ''
     OR TRIM(COALESCE(tanggal_lahir, '')) = ''
     OR TRIM(COALESCE(jenis_kelamin, '')) = ''
     OR TRIM(COALESCE(email, '')) = ''
     OR TRIM(COALESCE(no_hp, '')) = ''
     OR TRIM(COALESCE(alamat, '')) = '')
  `;

  function getCompletenessStats(): StudentCompletenessStats {
    const row = db
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN NOT ${INCOMPLETE_SQL_CONDITION} THEN 1 ELSE 0 END) as completeCount,
          SUM(CASE WHEN ${INCOMPLETE_SQL_CONDITION} THEN 1 ELSE 0 END) as incompleteCount,
          SUM(CASE WHEN TRIM(COALESCE(nik, '')) = '' THEN 1 ELSE 0 END) as missing_nik,
          SUM(CASE WHEN TRIM(COALESCE(tempat_lahir, '')) = '' THEN 1 ELSE 0 END) as missing_tempat_lahir,
          SUM(CASE WHEN TRIM(COALESCE(tanggal_lahir, '')) = '' THEN 1 ELSE 0 END) as missing_tanggal_lahir,
          SUM(CASE WHEN TRIM(COALESCE(jenis_kelamin, '')) = '' THEN 1 ELSE 0 END) as missing_jenis_kelamin,
          SUM(CASE WHEN TRIM(COALESCE(email, '')) = '' THEN 1 ELSE 0 END) as missing_email,
          SUM(CASE WHEN TRIM(COALESCE(no_hp, '')) = '' THEN 1 ELSE 0 END) as missing_no_hp,
          SUM(CASE WHEN TRIM(COALESCE(alamat, '')) = '' THEN 1 ELSE 0 END) as missing_alamat
        FROM students
      `)
      .get() as Record<string, number | null>;

    return {
      total: Number(row?.total || 0),
      completeCount: Number(row?.completeCount || 0),
      incompleteCount: Number(row?.incompleteCount || 0),
      missingCounts: {
        nik: Number(row?.missing_nik || 0),
        tempat_lahir: Number(row?.missing_tempat_lahir || 0),
        tanggal_lahir: Number(row?.missing_tanggal_lahir || 0),
        jenis_kelamin: Number(row?.missing_jenis_kelamin || 0),
        email: Number(row?.missing_email || 0),
        no_hp: Number(row?.missing_no_hp || 0),
        alamat: Number(row?.missing_alamat || 0),
      },
    };
  }

  // Staff: List Students
  app.get('/api/students', requireStaff, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const prodi = typeof req.query.prodi === 'string' ? req.query.prodi.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const completeness =
      typeof req.query.completeness === 'string' ? req.query.completeness.trim() : 'ALL';

    let sql = 'SELECT * FROM students WHERE 1=1';
    const params: unknown[] = [];

    if (q) {
      sql += ' AND (LOWER(nim) LIKE ? OR LOWER(nama) LIKE ? OR LOWER(prodi) LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (prodi && prodi !== 'ALL') {
      sql += ' AND prodi = ?';
      params.push(prodi);
    }
    if (status && status !== 'ALL') {
      sql += ' AND status_akademik = ?';
      params.push(status);
    }
    if (completeness === 'INCOMPLETE') {
      sql += ` AND ${INCOMPLETE_SQL_CONDITION}`;
    } else if (completeness === 'COMPLETE') {
      sql += ` AND NOT ${INCOMPLETE_SQL_CONDITION}`;
    } else if (completeness === 'MISSING_NIK') {
      sql += " AND TRIM(COALESCE(nik, '')) = ''";
    } else if (completeness === 'MISSING_TTL') {
      sql +=
        " AND (TRIM(COALESCE(tempat_lahir, '')) = '' OR TRIM(COALESCE(tanggal_lahir, '')) = '')";
    } else if (completeness === 'MISSING_CONTACT') {
      sql += " AND (TRIM(COALESCE(email, '')) = '' OR TRIM(COALESCE(no_hp, '')) = '')";
    } else if (completeness === 'MISSING_ALAMAT') {
      sql += " AND TRIM(COALESCE(alamat, '')) = ''";
    }

    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : '';
    const sortDir =
      typeof req.query.sortDir === 'string' && req.query.sortDir.trim().toLowerCase() === 'desc'
        ? 'DESC'
        : 'ASC';

    let orderClause = ' ORDER BY updated_at DESC, nama ASC';
    switch (sortBy) {
      case 'nim':
        orderClause = ` ORDER BY TRIM(nim) ${sortDir}, nama ASC`;
        break;
      case 'status':
      case 'status_akademik':
        orderClause = ` ORDER BY LOWER(TRIM(COALESCE(status_akademik, ''))) ${sortDir}, nama ASC`;
        break;
      case 'angkatan':
        orderClause = ` ORDER BY CAST(TRIM(COALESCE(angkatan, '0')) AS INTEGER) ${sortDir}, TRIM(COALESCE(angkatan, '')) ${sortDir}, nama ASC`;
        break;
      case 'prodi':
        orderClause = ` ORDER BY LOWER(TRIM(COALESCE(prodi, ''))) ${sortDir}, nama ASC`;
        break;
      default:
        orderClause = ' ORDER BY updated_at DESC, nama ASC';
        break;
    }

    sql += orderClause;
    const students = db.prepare(sql).all(...params) as StudentRecord[];

    const prodiRows = db
      .prepare('SELECT DISTINCT prodi FROM students ORDER BY prodi ASC')
      .all() as { prodi: string }[];

    const importLogs = db
      .prepare('SELECT * FROM import_logs ORDER BY created_at DESC LIMIT 5')
      .all();

    res.json({
      students,
      prodiList: prodiRows.map((r) => r.prodi),
      importLogs,
      completenessStats: getCompletenessStats(),
    });
  });

  // Staff: Export Incomplete Students to Excel for Bulk Completion
  app.get('/api/students/incomplete-excel', requireStaff, async (_req, res) => {
    const incompleteRows = db
      .prepare(`SELECT * FROM students WHERE ${INCOMPLETE_SQL_CONDITION} ORDER BY prodi ASC, nama ASC`)
      .all() as StudentRecord[];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data Belum Lengkap');

    worksheet.columns = [
      { header: 'NPM / NIM', key: 'nim', width: 16 },
      { header: 'Nama Lengkap', key: 'nama', width: 32 },
      { header: 'Program Studi', key: 'prodi', width: 24 },
      { header: 'NIK', key: 'nik', width: 20 },
      { header: 'Tempat Lahir', key: 'tempat_lahir', width: 18 },
      { header: 'Tanggal Lahir', key: 'tanggal_lahir', width: 14 },
      { header: 'Jenis Kelamin', key: 'jenis_kelamin', width: 14 },
      { header: 'Jenjang', key: 'jenjang', width: 14 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'No HP', key: 'no_hp', width: 16 },
      { header: 'Alamat', key: 'alamat', width: 36 },
      { header: 'Status', key: 'status_akademik', width: 14 },
    ];

    worksheet.addRows(
      incompleteRows.map((s) => ({
        nim: s.nim,
        nama: s.nama,
        prodi: s.prodi,
        nik: s.nik || '',
        tempat_lahir: s.tempat_lahir || '',
        tanggal_lahir: s.tanggal_lahir || '',
        jenis_kelamin: s.jenis_kelamin || '',
        jenjang: s.jenjang || '',
        email: s.email || '',
        no_hp: s.no_hp || '',
        alamat: s.alamat || '',
        status_akademik: s.status_akademik || 'Aktif',
      }))
    );

    worksheet.getRow(1).font = { bold: true };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Data_Mahasiswa_Belum_Lengkap.xlsx"'
    );
    res.send(buffer);
  });

  // Staff: Download Excel Template
  app.get('/api/students/template-excel', requireStaff, async (_req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data Mahasiswa');

    worksheet.columns = [
      { header: 'NPM / NIM', key: 'nim', width: 16 },
      { header: 'NIK', key: 'nik', width: 20 },
      { header: 'Nama Lengkap', key: 'nama', width: 28 },
      { header: 'Tempat Lahir', key: 'tempat_lahir', width: 16 },
      { header: 'Tanggal Lahir', key: 'tanggal_lahir', width: 14 },
      { header: 'Jenis Kelamin', key: 'jenis_kelamin', width: 14 },
      { header: 'Jenjang', key: 'jenjang', width: 14 },
      { header: 'Program Studi', key: 'prodi', width: 22 },
      { header: 'Fakultas', key: 'fakultas', width: 22 },
      { header: 'Angkatan', key: 'angkatan', width: 10 },
      { header: 'Semester', key: 'semester', width: 10 },
      { header: 'IPK', key: 'ipk', width: 8 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'No HP', key: 'no_hp', width: 16 },
      { header: 'Alamat', key: 'alamat', width: 34 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    worksheet.addRows([
      {
        nim: '202541012',
        nik: '6404094704050002',
        nama: 'TRI DIAH CAHYA AYU PRATIWI',
        tempat_lahir: 'TARAKAN',
        tanggal_lahir: '2005-04-07',
        jenis_kelamin: 'Perempuan',
        jenjang: 'SARJANA (S1)',
        prodi: 'MANAJEMEN',
        fakultas: 'Fakultas Ekonomi',
        angkatan: '2025',
        semester: 3,
        ipk: '3.78',
        email: 'tri.diah@unikaltar.ac.id',
        no_hp: '081234567890',
        alamat: 'Jln. BELUAN, SESAYAP HILIR',
        status: 'Aktif',
      },
      {
        nim: '230211100202',
        nik: '6501026209050001',
        nama: 'Dewi Anggraini',
        tempat_lahir: 'Tarakan',
        tanggal_lahir: '2005-09-22',
        jenis_kelamin: 'Perempuan',
        jenjang: 'SARJANA (S1)',
        prodi: 'AKUNTANSI',
        fakultas: 'Fakultas Ekonomi',
        angkatan: '2023',
        semester: 5,
        ipk: '3.88',
        email: 'dewi.anggraini@unikaltar.ac.id',
        no_hp: '081345670002',
        alamat: 'Jl. Kolonel Soetadji No. 12, Tanjung Selor',
        status: 'Aktif',
      },
      {
        nim: '210411100203',
        nik: '6501011011030005',
        nama: 'Fajar Ramadhan',
        tempat_lahir: 'Bulungan',
        tanggal_lahir: '2003-11-10',
        jenis_kelamin: 'Laki-laki',
        jenjang: 'SARJANA (S1)',
        prodi: 'EKONOMI PEMBANGUNAN',
        fakultas: 'Fakultas Ekonomi',
        angkatan: '2021',
        semester: 8,
        ipk: '3.64',
        email: 'fajar.ramadhan@unikaltar.ac.id',
        no_hp: '085712340003',
        alamat: 'Jl. Sabanar Lama No. 55, Tanjung Selor',
        status: 'Lulus',
      },
    ]);

    worksheet.getRow(1).font = { bold: true };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="Template_Data_Mahasiswa.xlsx"');
    res.send(buffer);
  });

  // Staff: Import Excel File (.xlsx / .csv)
  app.post(
    '/api/students/import-excel',
    requireStaff,
    excelUpload.single('file'),
    async (req: AuthedRequest, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Pilih file Excel (.xlsx atau .csv) terlebih dahulu.' });
        return;
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!['.xlsx', '.csv'].includes(ext)) {
        res.status(400).json({
          error: 'Format file tidak didukung. Unggah file Excel modern (.xlsx) atau CSV (.csv).',
        });
        return;
      }

      const rows: Record<string, unknown>[] = [];
      try {
        const workbook = new ExcelJS.Workbook();
        let worksheet: ExcelJS.Worksheet | undefined;
        if (ext === '.csv') {
          worksheet = await workbook.csv.read(Readable.from(req.file.buffer));
        } else {
          await workbook.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
          worksheet = workbook.worksheets[0];
        }

        if (!worksheet) {
          res.status(400).json({ error: 'File Excel tidak memiliki lembar kerja (sheet).' });
          return;
        }

        const headers: string[] = [];
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (rowNumber === 1) {
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
              headers[colNumber] = String(cell.text || cell.value || '').trim();
            });
            return;
          }

          const obj: Record<string, unknown> = {};
          let hasValue = false;
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const h = headers[colNumber];
            if (!h) return;
            const rawVal = cell.value;
            let textVal = '';
            if (rawVal instanceof Date) {
              textVal = rawVal.toISOString().slice(0, 10);
            } else if (rawVal && typeof rawVal === 'object' && 'text' in rawVal) {
              textVal = String((rawVal as { text: unknown }).text ?? '').trim();
            } else if (rawVal && typeof rawVal === 'object' && 'result' in rawVal) {
              textVal = String((rawVal as { result: unknown }).result ?? '').trim();
            } else if (rawVal !== null && rawVal !== undefined) {
              textVal = String(rawVal).trim();
            }
            if (textVal) hasValue = true;
            obj[h] = textVal;
          });
          if (hasValue) rows.push(obj);
        });
      } catch {
        res.status(400).json({ error: 'Gagal membaca file Excel. Pastikan format .xlsx atau .csv valid dan tidak terenkripsi.' });
        return;
      }

      if (rows.length === 0) {
        res.status(400).json({ error: 'Sheet Excel kosong. Tambahkan baris data mahasiswa terlebih dahulu.' });
        return;
      }

      const rawMode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : 'upsert';
      const importMode: 'upsert' | 'replace' | 'fill_empty' =
        rawMode === 'replace' || rawMode === 'fill_empty' ? rawMode : 'upsert';

      const now = new Date().toISOString();
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let deletedOld = 0;
      const errors: string[] = [];
      const importedNims: string[] = [];
      const seenNims = new Set<string>();

      const checkExisting = db.prepare('SELECT nim FROM students WHERE nim = ?');

      // In upsert mode: update with non-empty incoming values while preserving already-filled DB fields if Excel cell is blank.
      const upsertStmt = db.prepare(`
        INSERT INTO students (
          nim, nama, prodi, fakultas, angkatan, semester, ipk, email, no_hp,
          tempat_lahir, tanggal_lahir, jenis_kelamin, nik, jenjang, alamat, status_akademik, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(nim) DO UPDATE SET
          nama = COALESCE(NULLIF(TRIM(excluded.nama), ''), students.nama),
          prodi = COALESCE(NULLIF(TRIM(excluded.prodi), ''), students.prodi),
          fakultas = COALESCE(NULLIF(TRIM(excluded.fakultas), ''), students.fakultas),
          angkatan = COALESCE(NULLIF(TRIM(excluded.angkatan), ''), students.angkatan),
          semester = CASE WHEN excluded.semester > 0 THEN excluded.semester ELSE students.semester END,
          ipk = COALESCE(NULLIF(TRIM(excluded.ipk), ''), students.ipk),
          email = COALESCE(NULLIF(TRIM(excluded.email), ''), students.email),
          no_hp = COALESCE(NULLIF(TRIM(excluded.no_hp), ''), students.no_hp),
          tempat_lahir = COALESCE(NULLIF(TRIM(excluded.tempat_lahir), ''), students.tempat_lahir),
          tanggal_lahir = COALESCE(NULLIF(TRIM(excluded.tanggal_lahir), ''), students.tanggal_lahir),
          jenis_kelamin = COALESCE(NULLIF(TRIM(excluded.jenis_kelamin), ''), students.jenis_kelamin),
          nik = COALESCE(NULLIF(TRIM(excluded.nik), ''), students.nik),
          jenjang = COALESCE(NULLIF(TRIM(excluded.jenjang), ''), students.jenjang),
          alamat = COALESCE(NULLIF(TRIM(excluded.alamat), ''), students.alamat),
          status_akademik = COALESCE(NULLIF(TRIM(excluded.status_akademik), ''), students.status_akademik),
          updated_at = excluded.updated_at
      `);

      // In fill_empty mode: only fill columns that are currently empty in DB.
      const fillEmptyStmt = db.prepare(`
        INSERT INTO students (
          nim, nama, prodi, fakultas, angkatan, semester, ipk, email, no_hp,
          tempat_lahir, tanggal_lahir, jenis_kelamin, nik, jenjang, alamat, status_akademik, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(nim) DO UPDATE SET
          email = CASE WHEN TRIM(COALESCE(students.email, '')) = '' THEN excluded.email ELSE students.email END,
          no_hp = CASE WHEN TRIM(COALESCE(students.no_hp, '')) = '' THEN excluded.no_hp ELSE students.no_hp END,
          tempat_lahir = CASE WHEN TRIM(COALESCE(students.tempat_lahir, '')) = '' THEN excluded.tempat_lahir ELSE students.tempat_lahir END,
          tanggal_lahir = CASE WHEN TRIM(COALESCE(students.tanggal_lahir, '')) = '' THEN excluded.tanggal_lahir ELSE students.tanggal_lahir END,
          jenis_kelamin = CASE WHEN TRIM(COALESCE(students.jenis_kelamin, '')) = '' THEN excluded.jenis_kelamin ELSE students.jenis_kelamin END,
          nik = CASE WHEN TRIM(COALESCE(students.nik, '')) = '' THEN excluded.nik ELSE students.nik END,
          jenjang = CASE WHEN TRIM(COALESCE(students.jenjang, '')) = '' THEN excluded.jenjang ELSE students.jenjang END,
          alamat = CASE WHEN TRIM(COALESCE(students.alamat, '')) = '' THEN excluded.alamat ELSE students.alamat END,
          ipk = CASE WHEN TRIM(COALESCE(students.ipk, '')) IN ('', '0', '0.00') AND TRIM(excluded.ipk) != '' THEN excluded.ipk ELSE students.ipk END,
          updated_at = excluded.updated_at
      `);

      const runImport = db.transaction(() => {
        rows.forEach((row, index) => {
          const nim = pickField(row, [
            'nim',
            'npm_nim',
            'nomor_induk_mahasiswa',
            'nomor_pokok_mahasiswa',
            'no_induk',
            'no_induk_mahasiswa',
            'npm',
            'student_id',
          ]);
          const nama = pickField(row, ['nama', 'nama_lengkap', 'nama_mahasiswa', 'name', 'full_name']);
          const prodi =
            pickField(row, ['program_studi', 'prodi', 'jurusan', 'major', 'department']) ||
            'MANAJEMEN';
          const fakultas =
            pickField(row, ['fakultas', 'faculty']) || 'Fakultas Ekonomi';

          if (!nim || !nama) {
            skipped++;
            errors.push(`Baris ${index + 2}: kolom NIM/NPM atau Nama kosong.`);
            return;
          }

          seenNims.add(nim);

          const angkatan = pickField(row, ['angkatan', 'tahun_masuk', 'batch']) || nim.slice(0, 4) || '2025';
          const semRaw = pickField(row, ['semester', 'sem']);
          const semester = Math.max(1, Math.min(14, Number.parseInt(semRaw, 10) || 1));
          const ipk = pickField(row, ['ipk', 'gpa']) || '';
          const email = pickField(row, ['email', 'surel', 'e_mail', 'email_pribadi']);
          const no_hp = pickField(row, [
            'no_hp',
            'hp',
            'no_telepon',
            'telepon',
            'no_telp',
            'telepon_seluler',
            'handphone',
            'whatsapp',
            'phone',
          ]);
          const tempat_lahir = pickField(row, ['tempat_lahir', 'tmp_lahir', 'kota_lahir', 'birth_place']);
          const tanggal_lahir = pickField(row, ['tanggal_lahir', 'tgl_lahir', 'birth_date']);
          const jenis_kelamin = pickField(row, ['jenis_kelamin', 'jk', 'kelamin', 'gender']);
          const rawNik = pickField(row, [
            'nik',
            'nomor_induk_kependudukan',
            'no_nik',
            'no_ktp',
          ]);
          // Guard against identity-type labels like "Ktp" being saved as NIK
          const nik = /\d{6,}/.test(rawNik) ? rawNik : '';
          const jenjang = pickField(row, ['jenjang', 'strata', 'degree']) || 'SARJANA (S1)';
          const alamat = pickField(row, ['alamat', 'alamat_lengkap', 'alamat_ktp', 'address']);
          const status_akademik =
            pickField(row, ['status', 'status_akademik', 'status_mahasiswa']) || 'Aktif';

          const exists = checkExisting.get(nim);
          const stmt = importMode === 'fill_empty' ? fillEmptyStmt : upsertStmt;
          stmt.run(
            nim,
            nama,
            prodi,
            fakultas,
            angkatan,
            semester,
            ipk || (exists ? '' : '0.00'),
            email,
            no_hp,
            tempat_lahir,
            tanggal_lahir,
            jenis_kelamin,
            nik,
            jenjang,
            alamat,
            status_akademik,
            now
          );
          if (exists) {
            updated++;
          } else {
            inserted++;
          }
          importedNims.push(nim);
        });

        if (importMode === 'replace' && seenNims.size > 0) {
          const existingNims = db.prepare('SELECT nim FROM students').all() as { nim: string }[];
          const deleteStmt = db.prepare('DELETE FROM students WHERE nim = ?');
          for (const row of existingNims) {
            if (!seenNims.has(row.nim)) {
              deleteStmt.run(row.nim);
              deletedOld++;
            }
          }
        }

        db.prepare(`
          INSERT INTO import_logs (
            id, filename, total_rows, inserted_count, updated_count, skipped_count, imported_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          req.file!.originalname,
          rows.length,
          inserted,
          updated,
          skipped,
          req.auth?.staffName || 'Staf Administrasi',
          now
        );
      });

      runImport();

      res.json({
        totalRows: rows.length,
        inserted,
        updated,
        skipped,
        deletedOld,
        mode: importMode,
        errors: errors.slice(0, 10),
        importedNims: importedNims.slice(0, 8),
      });
    }
  );

  // Staff: Upsert single student manually
  app.post('/api/students', requireStaff, (req, res) => {
    const body = req.body || {};
    const nim = typeof body.nim === 'string' ? body.nim.trim() : '';
    const nama = typeof body.nama === 'string' ? body.nama.trim() : '';
    const prodi = typeof body.prodi === 'string' ? body.prodi.trim() : '';
    const fakultas = typeof body.fakultas === 'string' ? body.fakultas.trim() : '';

    if (!nim || !nama || !prodi || !fakultas) {
      res.status(400).json({ error: 'NIM, Nama, Program Studi, dan Fakultas wajib diisi.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO students (
        nim, nama, prodi, fakultas, angkatan, semester, ipk, email, no_hp,
        tempat_lahir, tanggal_lahir, jenis_kelamin, nik, jenjang, alamat, status_akademik, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(nim) DO UPDATE SET
        nama = excluded.nama,
        prodi = excluded.prodi,
        fakultas = excluded.fakultas,
        angkatan = excluded.angkatan,
        semester = excluded.semester,
        ipk = excluded.ipk,
        email = excluded.email,
        no_hp = excluded.no_hp,
        tempat_lahir = excluded.tempat_lahir,
        tanggal_lahir = excluded.tanggal_lahir,
        jenis_kelamin = excluded.jenis_kelamin,
        nik = excluded.nik,
        jenjang = excluded.jenjang,
        alamat = excluded.alamat,
        status_akademik = excluded.status_akademik,
        updated_at = excluded.updated_at
    `).run(
      nim,
      nama,
      prodi,
      fakultas,
      String(body.angkatan || '2025'),
      Math.max(1, Number.parseInt(String(body.semester || '1'), 10) || 1),
      String(body.ipk || '0.00'),
      String(body.email || ''),
      String(body.no_hp || ''),
      String(body.tempat_lahir || ''),
      String(body.tanggal_lahir || ''),
      String(body.jenis_kelamin || ''),
      String(body.nik || ''),
      String(body.jenjang || 'SARJANA (S1)'),
      String(body.alamat || ''),
      String(body.status_akademik || 'Aktif'),
      now
    );

    const saved = db.prepare('SELECT * FROM students WHERE nim = ?').get(nim);
    res.json({ student: saved });
  });

  // Student: Complete or update own biodata fields
  app.put('/api/student/profile', requireStudent, (req: AuthedRequest, res) => {
    const nim = req.auth!.nim!;
    const existing = db
      .prepare('SELECT * FROM students WHERE nim = ?')
      .get(nim) as StudentRecord | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Data mahasiswa tidak ditemukan.' });
      return;
    }

    const body = req.body || {};
    const cleanStr = (val: unknown, fallback: string, maxLen = 240): string => {
      if (typeof val !== 'string') return fallback;
      return val.trim().slice(0, maxLen);
    };

    const nextNik = cleanStr(body.nik, existing.nik, 30);
    const nextTempatLahir = cleanStr(body.tempat_lahir, existing.tempat_lahir, 100);
    const nextTanggalLahir = cleanStr(body.tanggal_lahir, existing.tanggal_lahir, 20);
    const nextJenisKelamin = cleanStr(body.jenis_kelamin, existing.jenis_kelamin, 30);
    const nextJenjang = cleanStr(body.jenjang, existing.jenjang, 60) || existing.jenjang;
    const nextEmail = cleanStr(body.email, existing.email, 140);
    const nextNoHp = cleanStr(body.no_hp, existing.no_hp, 40);
    const nextAlamat = cleanStr(body.alamat, existing.alamat, 300);

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE students
      SET nik = ?, tempat_lahir = ?, tanggal_lahir = ?, jenis_kelamin = ?,
          jenjang = ?, email = ?, no_hp = ?, alamat = ?, updated_at = ?
      WHERE nim = ?
    `).run(
      nextNik,
      nextTempatLahir,
      nextTanggalLahir,
      nextJenisKelamin,
      nextJenjang,
      nextEmail,
      nextNoHp,
      nextAlamat,
      now,
      nim
    );

    const updated = db.prepare('SELECT * FROM students WHERE nim = ?').get(nim) as StudentRecord;
    res.json({ student: updated });
  });

  // Staff: Delete Student
  app.delete('/api/students/:nim', requireStaff, (req, res) => {
    const nim = String(req.params.nim || '').trim();
    const result = db.prepare('DELETE FROM students WHERE nim = ?').run(nim);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Mahasiswa tidak ditemukan.' });
      return;
    }
    res.json({ deleted: true });
  });

  // Student: List Own Requests
  app.get('/api/requests/mine', requireStudent, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM letter_requests WHERE student_nim = ? ORDER BY created_at DESC')
      .all(req.auth!.nim!) as Record<string, unknown>[];

    res.json({ requests: rows.map(mapRequestRow) });
  });

  // Student: Submit New Letter Request + Supporting Documents
  app.post(
    '/api/requests',
    requireStudent,
    docUpload.array('files', 6),
    (req: AuthedRequest, res) => {
      const letterType = typeof req.body?.letter_type === 'string' ? req.body.letter_type.trim() : '';
      const service = getConfiguredLetterService(letterType);
      if (!service) {
        res.status(400).json({ error: 'Jenis layanan surat tidak valid.' });
        return;
      }

      let formData: Record<string, string> = {};
      try {
        formData = JSON.parse(String(req.body?.form_data || '{}'));
      } catch {
        res.status(400).json({ error: 'Format data formulir tidak valid.' });
        return;
      }

      const studentRow = db
        .prepare('SELECT * FROM students WHERE nim = ?')
        .get(req.auth!.nim!) as StudentRecord | undefined;

      for (const field of service.formFields) {
        if (field.type === 'select' && field.locked) {
          const lockedValue = resolveFormFieldInitialValue(field, studentRow);
          if (lockedValue) {
            formData[field.name] = lockedValue;
          }
        } else if (service.id === 'AKTIF_KULIAH' && field.name === 'mulai_studi') {
          const autoStartStudy = formatMulaiStudiText(studentRow);
          if (autoStartStudy) {
            formData[field.name] = autoStartStudy;
          }
        }
        const isHiddenAutoStartStudy =
          service.id === 'AKTIF_KULIAH' && field.name === 'mulai_studi';
        if (
          field.required &&
          !isHiddenAutoStartStudy &&
          (!formData[field.name] || !String(formData[field.name]).trim())
        ) {
          res.status(400).json({ error: `Kolom "${field.label}" wajib diisi.` });
          return;
        }
      }

      if (service.id === 'IZIN_OBSERVASI') {
        if (String(formData.jenis_observasi || '').trim() !== 'Observasi Kelompok') {
          formData.anggota_kelompok = '';
        } else if (!String(formData.anggota_kelompok || '').trim()) {
          res.status(400).json({
            error: 'Kolom "Daftar Nama & NPM Anggota Kelompok" wajib diisi untuk observasi kelompok.',
          });
          return;
        }
      }

      const files = (req.files as Express.Multer.File[]) || [];
      let docTypes: string[] = [];
      try {
        docTypes = JSON.parse(String(req.body?.doc_types || '[]'));
      } catch {
        docTypes = [];
      }

      const submitMode =
        typeof req.body?.submit_mode === 'string' ? req.body.submit_mode.trim() : 'full';
      const isStep1DraftOnly = service.id === 'PINDAH_KULIAH' && submitMode === 'step1_only';

      if (!isStep1DraftOnly && service.requiredDocuments.length > 0 && files.length === 0) {
        res.status(400).json({ error: 'Unggah minimal satu dokumen pendukung untuk diverifikasi staf.' });
        return;
      }

      if (!isStep1DraftOnly && service.id === 'PINDAH_KULIAH') {
        const requiredLabels = service.requiredDocuments
          .filter((d) => d.required)
          .map((d) => d.label);
        const uploadedTypeSet = new Set(
          docTypes.map((dt) => String(dt || '').trim()).filter(Boolean)
        );
        const missingDoc = requiredLabels.find((lbl) => !uploadedTypeSet.has(lbl));
        if (missingDoc || files.length < requiredLabels.length) {
          res.status(400).json({
            error: `Langkah 2 mewajibkan seluruh 3 berkas pindah kuliah diunggah lengkap (${missingDoc || '3 berkas persyaratan'}).`,
          });
          return;
        }
      }

      for (const f of files) {
        if (!ALLOWED_DOC_MIMES[f.mimetype] || !isValidDocBuffer(f.buffer, f.mimetype)) {
          res.status(400).json({
            error: `File "${f.originalname}" bukan file PDF, JPG, atau PNG yang valid.`,
          });
          return;
        }
      }

      const initialStatus: RequestStatus = isStep1DraftOnly
        ? 'Menunggu Berkas'
        : 'Menunggu Verifikasi';

      const now = new Date().toISOString();
      const requestId = crypto.randomUUID();
      const trackingCode = generateNextTrackingCode();
      const tplSettings = getLetterTemplateSettings();
      const defaultChecklist = service.defaultChecklist.map((label, idx) => ({
        id: `c${idx + 1}`,
        label,
        checked: false,
      }));

      const savedFiles: { storedName: string; path: string }[] = [];
      try {
        const writeTx = db.transaction(() => {
          db.prepare(`
            INSERT INTO letter_requests (
              id, tracking_code, student_nim, letter_type, status, form_data_json,
              verification_notes, verified_by, verified_at, official_number,
              signatory_name, signatory_nidn, signatory_title, signatory_nik,
              checklist_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            requestId,
            trackingCode,
            req.auth!.nim!,
            service.id,
            initialStatus,
            JSON.stringify(formData),
            '',
            '',
            null,
            '',
            tplSettings.signatory_name,
            tplSettings.signatory_nidn,
            tplSettings.signatory_title,
            tplSettings.signatory_nik,
            JSON.stringify(defaultChecklist),
            now,
            now
          );

          const insertDoc = db.prepare(`
            INSERT INTO request_documents (
              id, request_id, doc_type, original_name, mime_type, size_bytes, stored_name, uploaded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          files.forEach((file, idx) => {
            const ext = ALLOWED_DOC_MIMES[file.mimetype] || '.pdf';
            const storedName = `${crypto.randomUUID()}${ext}`;
            const targetPath = path.resolve(UPLOAD_DIR, storedName);
            if (!targetPath.startsWith(UPLOAD_DIR + path.sep)) {
              throw new Error('Invalid storage path');
            }
            fs.writeFileSync(targetPath, file.buffer);
            savedFiles.push({ storedName, path: targetPath });

            const docTypeLabel =
              typeof docTypes[idx] === 'string' && docTypes[idx].trim()
                ? docTypes[idx].trim()
                : 'Dokumen Pendukung';

            insertDoc.run(
              crypto.randomUUID(),
              requestId,
              docTypeLabel,
              file.originalname,
              file.mimetype,
              file.size,
              storedName,
              now
            );
          });

          // Automatically update student address and empty biodata fields on student record from submitted form
          db.prepare(`
            UPDATE students
            SET
              nik = CASE WHEN TRIM(COALESCE(nik, '')) = '' AND TRIM(?) != '' THEN ? ELSE nik END,
              tempat_lahir = CASE WHEN TRIM(COALESCE(tempat_lahir, '')) = '' AND TRIM(?) != '' THEN ? ELSE tempat_lahir END,
              tanggal_lahir = CASE WHEN TRIM(COALESCE(tanggal_lahir, '')) = '' AND TRIM(?) != '' THEN ? ELSE tanggal_lahir END,
              jenis_kelamin = CASE WHEN TRIM(COALESCE(jenis_kelamin, '')) = '' AND TRIM(?) != '' THEN ? ELSE jenis_kelamin END,
              alamat = CASE WHEN TRIM(?) != '' THEN ? ELSE alamat END
            WHERE nim = ?
          `).run(
            String(formData.nik || '').trim(),
            String(formData.nik || '').trim(),
            String(formData.tempat_lahir || '').trim(),
            String(formData.tempat_lahir || '').trim(),
            String(formData.tanggal_lahir || '').trim(),
            String(formData.tanggal_lahir || '').trim(),
            String(formData.jenis_kelamin || '').trim(),
            String(formData.jenis_kelamin || '').trim(),
            String(formData.alamat || '').trim(),
            String(formData.alamat || '').trim(),
            req.auth!.nim!
          );
        });

        writeTx();
      } catch (err) {
        for (const sf of savedFiles) {
          try {
            fs.unlinkSync(sf.path);
          } catch {
            // ignore cleanup error
          }
        }
        console.error(err);
        res.status(500).json({ error: 'Terjadi kesalahan saat menyimpan pengajuan surat.' });
        return;
      }

      const row = db
        .prepare('SELECT * FROM letter_requests WHERE id = ?')
        .get(requestId) as Record<string, unknown>;
      res.status(201).json({ request: mapRequestRow(row) });
    }
  );

  // Student: Resubmit when status is Perlu Revisi
  app.post(
    '/api/requests/:id/resubmit',
    requireStudent,
    docUpload.array('files', 6),
    (req: AuthedRequest, res) => {
      const requestId = String(req.params.id || '');
      const existing = db
        .prepare('SELECT * FROM letter_requests WHERE id = ?')
        .get(requestId) as Record<string, unknown> | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Pengajuan surat tidak ditemukan.' });
        return;
      }
      if (String(existing.student_nim) !== req.auth!.nim) {
        res.status(403).json({ error: 'Anda tidak memiliki akses ke pengajuan ini.' });
        return;
      }
      if (String(existing.status) !== 'Perlu Revisi') {
        res.status(400).json({ error: 'Hanya pengajuan berstatus Perlu Revisi yang dapat diajukan ulang.' });
        return;
      }

      let formData: Record<string, string> = {};
      try {
        formData = JSON.parse(String(req.body?.form_data || existing.form_data_json));
      } catch {
        res.status(400).json({ error: 'Format data formulir tidak valid.' });
        return;
      }

      const service = getConfiguredLetterService(String(existing.letter_type));
      if (service) {
        let existingFormData: Record<string, string> = {};
        try {
          existingFormData = JSON.parse(String(existing.form_data_json || '{}'));
        } catch {
          existingFormData = {};
        }
        const studentRow = db
          .prepare('SELECT * FROM students WHERE nim = ?')
          .get(req.auth!.nim!) as StudentRecord | undefined;

        for (const field of service.formFields) {
          if (field.type === 'select' && field.locked) {
            const lockedValue =
              String(existingFormData[field.name] || '').trim() ||
              resolveFormFieldInitialValue(field, studentRow);
            if (lockedValue) {
              formData[field.name] = lockedValue;
            }
          } else if (service.id === 'AKTIF_KULIAH' && field.name === 'mulai_studi') {
            const autoStartStudy =
              formatMulaiStudiText(studentRow) ||
              String(existingFormData[field.name] || '').trim();
            if (autoStartStudy) {
              formData[field.name] = autoStartStudy;
            }
          }
        }
        if (service.id === 'IZIN_OBSERVASI') {
          if (String(formData.jenis_observasi || '').trim() !== 'Observasi Kelompok') {
            formData.anggota_kelompok = '';
          } else if (!String(formData.anggota_kelompok || '').trim()) {
            res.status(400).json({
              error:
                'Kolom "Daftar Nama & NPM Anggota Kelompok" wajib diisi untuk observasi kelompok.',
            });
            return;
          }
        }
      }

      const files = (req.files as Express.Multer.File[]) || [];
      let docTypes: string[] = [];
      try {
        docTypes = JSON.parse(String(req.body?.doc_types || '[]'));
      } catch {
        docTypes = [];
      }

      for (const f of files) {
        if (!ALLOWED_DOC_MIMES[f.mimetype] || !isValidDocBuffer(f.buffer, f.mimetype)) {
          res.status(400).json({ error: `File "${f.originalname}" bukan PDF, JPG, atau PNG yang valid.` });
          return;
        }
      }

      const now = new Date().toISOString();
      const savedFiles: string[] = [];

      try {
        const tx = db.transaction(() => {
          db.prepare(`
            UPDATE letter_requests
            SET form_data_json = ?, status = 'Menunggu Verifikasi', updated_at = ?
            WHERE id = ?
          `).run(JSON.stringify(formData), now, requestId);

          // Automatically update student address and empty biodata fields on student record from resubmitted form
          db.prepare(`
            UPDATE students
            SET
              nik = CASE WHEN TRIM(COALESCE(nik, '')) = '' AND TRIM(?) != '' THEN ? ELSE nik END,
              tempat_lahir = CASE WHEN TRIM(COALESCE(tempat_lahir, '')) = '' AND TRIM(?) != '' THEN ? ELSE tempat_lahir END,
              tanggal_lahir = CASE WHEN TRIM(COALESCE(tanggal_lahir, '')) = '' AND TRIM(?) != '' THEN ? ELSE tanggal_lahir END,
              jenis_kelamin = CASE WHEN TRIM(COALESCE(jenis_kelamin, '')) = '' AND TRIM(?) != '' THEN ? ELSE jenis_kelamin END,
              alamat = CASE WHEN TRIM(?) != '' THEN ? ELSE alamat END
            WHERE nim = ?
          `).run(
            String(formData.nik || '').trim(),
            String(formData.nik || '').trim(),
            String(formData.tempat_lahir || '').trim(),
            String(formData.tempat_lahir || '').trim(),
            String(formData.tanggal_lahir || '').trim(),
            String(formData.tanggal_lahir || '').trim(),
            String(formData.jenis_kelamin || '').trim(),
            String(formData.jenis_kelamin || '').trim(),
            String(formData.alamat || '').trim(),
            String(formData.alamat || '').trim(),
            req.auth!.nim!
          );

          const insertDoc = db.prepare(`
            INSERT INTO request_documents (
              id, request_id, doc_type, original_name, mime_type, size_bytes, stored_name, uploaded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          files.forEach((file, idx) => {
            const ext = ALLOWED_DOC_MIMES[file.mimetype] || '.pdf';
            const storedName = `${crypto.randomUUID()}${ext}`;
            const targetPath = path.resolve(UPLOAD_DIR, storedName);
            if (!targetPath.startsWith(UPLOAD_DIR + path.sep)) {
              throw new Error('Invalid storage path');
            }
            fs.writeFileSync(targetPath, file.buffer);
            savedFiles.push(targetPath);

            insertDoc.run(
              crypto.randomUUID(),
              requestId,
              typeof docTypes[idx] === 'string' && docTypes[idx].trim()
                ? docTypes[idx].trim()
                : 'Dokumen Revisi',
              file.originalname,
              file.mimetype,
              file.size,
              storedName,
              now
            );
          });
        });

        tx();
      } catch {
        for (const p of savedFiles) {
          try {
            fs.unlinkSync(p);
          } catch {
            // ignore
          }
        }
        res.status(500).json({ error: 'Gagal memperbarui pengajuan revisi.' });
        return;
      }

      const updated = db
        .prepare('SELECT * FROM letter_requests WHERE id = ?')
        .get(requestId) as Record<string, unknown>;
      res.json({ request: mapRequestRow(updated) });
    }
  );

  // Student: Step 2 Upload 3 Completed Documents (for Menunggu Berkas or Perlu Revisi)
  app.post(
    '/api/requests/:id/upload-documents',
    requireStudent,
    docUpload.array('files', 6),
    (req: AuthedRequest, res) => {
      const requestId = String(req.params.id || '');
      const existing = db
        .prepare('SELECT * FROM letter_requests WHERE id = ?')
        .get(requestId) as Record<string, unknown> | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Pengajuan surat tidak ditemukan.' });
        return;
      }
      if (String(existing.student_nim) !== req.auth!.nim) {
        res.status(403).json({ error: 'Anda tidak memiliki akses ke pengajuan ini.' });
        return;
      }
      const curStatus = String(existing.status);
      if (curStatus !== 'Menunggu Berkas' && curStatus !== 'Perlu Revisi') {
        res.status(400).json({
          error: 'Berkas hanya dapat diunggah saat status Menunggu Berkas atau Perlu Revisi.',
        });
        return;
      }

      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        res.status(400).json({ error: 'Pilih minimal satu berkas yang telah ditandatangani & distempel.' });
        return;
      }

      let docTypes: string[] = [];
      try {
        docTypes = JSON.parse(String(req.body?.doc_types || '[]'));
      } catch {
        docTypes = [];
      }

      for (const f of files) {
        if (!ALLOWED_DOC_MIMES[f.mimetype] || !isValidDocBuffer(f.buffer, f.mimetype)) {
          res.status(400).json({ error: `File "${f.originalname}" bukan PDF, JPG, atau PNG yang valid.` });
          return;
        }
      }

      const service = getConfiguredLetterService(String(existing.letter_type));
      const existingDocs = db
        .prepare('SELECT id, doc_type, stored_name FROM request_documents WHERE request_id = ?')
        .all(requestId) as { id: string; doc_type: string; stored_name: string }[];

      const resultingTypes = new Set(existingDocs.map((d) => String(d.doc_type || '').trim()));
      files.forEach((_, idx) => {
        const label =
          typeof docTypes[idx] === 'string' && docTypes[idx].trim()
            ? docTypes[idx].trim()
            : 'Dokumen Pendukung';
        resultingTypes.add(label);
      });

      if (service?.id === 'PINDAH_KULIAH') {
        const requiredLabels = service.requiredDocuments
          .filter((d) => d.required)
          .map((d) => d.label);
        const missing = requiredLabels.find((lbl) => !resultingTypes.has(lbl));
        if (missing) {
          res.status(400).json({
            error: `Seluruh 3 berkas persyaratan wajib dilengkapi sebelum dikirim. Masih kurang: "${missing}".`,
          });
          return;
        }
      }

      const now = new Date().toISOString();
      const savedPaths: string[] = [];
      const replacedStoredNames: string[] = [];

      try {
        const tx = db.transaction(() => {
          const deleteSameType = db.prepare(
            'DELETE FROM request_documents WHERE request_id = ? AND doc_type = ?'
          );
          const insertDoc = db.prepare(`
            INSERT INTO request_documents (
              id, request_id, doc_type, original_name, mime_type, size_bytes, stored_name, uploaded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          files.forEach((file, idx) => {
            const docTypeLabel =
              typeof docTypes[idx] === 'string' && docTypes[idx].trim()
                ? docTypes[idx].trim()
                : 'Dokumen Pendukung';

            for (const old of existingDocs) {
              if (old.doc_type === docTypeLabel && old.stored_name) {
                replacedStoredNames.push(old.stored_name);
              }
            }
            deleteSameType.run(requestId, docTypeLabel);

            const ext = ALLOWED_DOC_MIMES[file.mimetype] || '.pdf';
            const storedName = `${crypto.randomUUID()}${ext}`;
            const targetPath = path.resolve(UPLOAD_DIR, storedName);
            if (!targetPath.startsWith(UPLOAD_DIR + path.sep)) {
              throw new Error('Invalid storage path');
            }
            fs.writeFileSync(targetPath, file.buffer);
            savedPaths.push(targetPath);

            insertDoc.run(
              crypto.randomUUID(),
              requestId,
              docTypeLabel,
              file.originalname,
              file.mimetype,
              file.size,
              storedName,
              now
            );
          });

          db.prepare(`
            UPDATE letter_requests
            SET status = 'Menunggu Verifikasi', updated_at = ?
            WHERE id = ?
          `).run(now, requestId);
        });

        tx();

        for (const oldName of replacedStoredNames) {
          const safeOld = path.basename(oldName);
          const oldPath = path.resolve(UPLOAD_DIR, safeOld);
          if (oldPath.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(oldPath)) {
            try {
              fs.unlinkSync(oldPath);
            } catch {
              // ignore cleanup error
            }
          }
        }
      } catch {
        for (const p of savedPaths) {
          try {
            fs.unlinkSync(p);
          } catch {
            // ignore
          }
        }
        res.status(500).json({ error: 'Gagal menyimpan berkas yang diunggah.' });
        return;
      }

      const updated = db
        .prepare('SELECT * FROM letter_requests WHERE id = ?')
        .get(requestId) as Record<string, unknown>;
      res.json({ request: mapRequestRow(updated) });
    }
  );

  // Staff: List all requests + summary stats
  app.get('/api/requests', requireStaff, (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const letterType = typeof req.query.letter_type === 'string' ? req.query.letter_type.trim() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    let sql = `
      SELECT lr.*
      FROM letter_requests lr
      LEFT JOIN students s ON s.nim = lr.student_nim
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (status && status !== 'ALL') {
      sql += ' AND lr.status = ?';
      params.push(status);
    }
    if (letterType && letterType !== 'ALL') {
      sql += ' AND lr.letter_type = ?';
      params.push(letterType);
    }
    if (q) {
      sql +=
        ' AND (LOWER(lr.tracking_code) LIKE ? OR LOWER(lr.student_nim) LIKE ? OR LOWER(s.nama) LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    sql += ' ORDER BY lr.created_at DESC';
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

    const stats = {
      totalRequests: (
        db.prepare('SELECT COUNT(*) as c FROM letter_requests').get() as { c: number }
      ).c,
      pendingRequests: (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM letter_requests WHERE status IN ('Menunggu Verifikasi', 'Sedang Diproses')"
          )
          .get() as { c: number }
      ).c,
      approvedRequests: (
        db
          .prepare("SELECT COUNT(*) as c FROM letter_requests WHERE status = 'Disetujui'")
          .get() as { c: number }
      ).c,
      totalStudents: (db.prepare('SELECT COUNT(*) as c FROM students').get() as { c: number }).c,
    };

    res.json({
      requests: rows.map(mapRequestRow),
      stats,
      nextOfficialNumber: generateNextOfficialNumber(),
    });
  });

  // Staff: Digital Verification Action
  app.patch('/api/requests/:id/verify', requireStaff, (req: AuthedRequest, res) => {
    const requestId = String(req.params.id || '');
    const existing = db
      .prepare('SELECT * FROM letter_requests WHERE id = ?')
      .get(requestId) as Record<string, unknown> | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Pengajuan surat tidak ditemukan.' });
      return;
    }

    const nextStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    if (!ALLOWED_STATUSES.includes(nextStatus as RequestStatus)) {
      res.status(400).json({ error: 'Status verifikasi tidak valid.' });
      return;
    }

    const notes =
      typeof req.body?.verification_notes === 'string' ? req.body.verification_notes.trim() : '';

    if ((nextStatus === 'Perlu Revisi' || nextStatus === 'Ditolak') && !notes) {
      res.status(400).json({
        error: 'Berikan catatan verifikasi yang jelas apabila meminta revisi atau menolak pengajuan.',
      });
      return;
    }

    const service = getConfiguredLetterService(String(existing.letter_type));
    if (String(existing.letter_type) === 'PINDAH_KULIAH' && nextStatus === 'Disetujui') {
      const storedManualPdf = String(existing.manual_pdf_stored_name || '').trim();
      const resolvedManual = storedManualPdf
        ? path.resolve(UPLOAD_DIR, path.basename(storedManualPdf))
        : '';
      if (
        !storedManualPdf ||
        !resolvedManual.startsWith(UPLOAD_DIR + path.sep) ||
        !fs.existsSync(resolvedManual)
      ) {
        res.status(400).json({
          error:
            'Unggah file PDF Surat Pindah manual terlebih dahulu sebelum menyetujui dan menerbitkan surat untuk mahasiswa.',
        });
        return;
      }
    }

    const tplSettings = getLetterTemplateSettings();
    const now = new Date().toISOString();
    const requestedOfficialNumber =
      typeof req.body?.official_number === 'string' ? req.body.official_number.trim() : '';

    let officialNumber = String(existing.official_number || '').trim();
    if (nextStatus === 'Disetujui') {
      if (requestedOfficialNumber) {
        const collision = db
          .prepare('SELECT id FROM letter_requests WHERE official_number = ? AND id != ?')
          .get(requestedOfficialNumber, requestId) as { id: string } | undefined;
        officialNumber = collision
          ? generateNextOfficialNumber(service?.code || 'AKD', now)
          : requestedOfficialNumber;
      } else if (!officialNumber) {
        officialNumber = generateNextOfficialNumber(service?.code || 'AKD', now);
      }
    }

    const signatoryName =
      typeof req.body?.signatory_name === 'string' && req.body.signatory_name.trim()
        ? req.body.signatory_name.trim()
        : String(existing.signatory_name || tplSettings.signatory_name);

    const signatoryNidn =
      typeof req.body?.signatory_nidn === 'string' && req.body.signatory_nidn.trim()
        ? req.body.signatory_nidn.trim()
        : String(existing.signatory_nidn || tplSettings.signatory_nidn);

    const signatoryTitle =
      typeof req.body?.signatory_title === 'string' && req.body.signatory_title.trim()
        ? req.body.signatory_title.trim()
        : String(existing.signatory_title || tplSettings.signatory_title);

    const signatoryNik =
      typeof req.body?.signatory_nik === 'string' && req.body.signatory_nik.trim()
        ? req.body.signatory_nik.trim()
        : String(existing.signatory_nik || tplSettings.signatory_nik);

    const checklist = Array.isArray(req.body?.checklist) ? req.body.checklist : null;

    db.prepare(`
      UPDATE letter_requests
      SET
        status = ?,
        verification_notes = ?,
        verified_by = ?,
        verified_at = ?,
        official_number = ?,
        signatory_name = ?,
        signatory_nidn = ?,
        signatory_title = ?,
        signatory_nik = ?,
        checklist_json = COALESCE(?, checklist_json),
        updated_at = ?
      WHERE id = ?
    `).run(
      nextStatus,
      notes,
      req.auth?.staffName || 'Staf Administrasi Akademik',
      now,
      officialNumber,
      signatoryName,
      signatoryNidn,
      signatoryTitle,
      signatoryNik,
      checklist ? JSON.stringify(checklist) : null,
      now,
      requestId
    );

    const updated = db
      .prepare('SELECT * FROM letter_requests WHERE id = ?')
      .get(requestId) as Record<string, unknown>;
    res.json({ request: mapRequestRow(updated) });
  });

  // Staff: Edit Submitted Form Data
  app.patch('/api/requests/:id/form', requireStaff, (req: AuthedRequest, res) => {
    const requestId = String(req.params.id || '');
    const existing = db
      .prepare('SELECT * FROM letter_requests WHERE id = ?')
      .get(requestId) as Record<string, unknown> | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Pengajuan surat tidak ditemukan.' });
      return;
    }

    const incoming = req.body?.form_data;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      res.status(400).json({ error: 'Format data formulir tidak valid.' });
      return;
    }

    const service = getConfiguredLetterService(String(existing.letter_type));
    const sanitized: Record<string, string> = {};
    for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
      if (typeof k === 'string' && k.trim()) {
        sanitized[k.trim()] = v === null || v === undefined ? '' : String(v).trim();
      }
    }

    if (service) {
      for (const field of service.formFields) {
        if (field.required && !sanitized[field.name]) {
          res.status(400).json({ error: `Kolom "${field.label}" wajib diisi.` });
          return;
        }
      }
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE letter_requests
      SET form_data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(sanitized), now, requestId);

    const updated = db
      .prepare('SELECT * FROM letter_requests WHERE id = ?')
      .get(requestId) as Record<string, unknown>;
    res.json({ request: mapRequestRow(updated) });
  });

  // Staff: Upload Manual Official Letter PDF (e.g., Surat Pindah Kuliah made manually)
  app.post('/api/requests/:id/manual-letter-pdf', requireStaff, (req, res) => {
    manualPdfUpload.single('pdf')(req, res, (uploadErr) => {
      if (uploadErr) {
        const msg =
          uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE'
            ? 'Ukuran file PDF surat melebihi batas maksimal 15 MB.'
            : uploadErr.message || 'Gagal mengunggah file PDF surat.';
        res.status(400).json({ error: msg });
        return;
      }

      const requestId = String(req.params.id || '');
      const existing = db
        .prepare('SELECT * FROM letter_requests WHERE id = ?')
        .get(requestId) as Record<string, unknown> | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Pengajuan surat tidak ditemukan.' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Pilih file PDF surat terlebih dahulu.' });
        return;
      }

      const ext = path.extname(file.originalname || '').toLowerCase();
      if ((file.mimetype !== 'application/pdf' && ext !== '.pdf') || !isValidPdfBuffer(file.buffer)) {
        res.status(400).json({ error: 'File yang diunggah harus berupa dokumen PDF (.pdf) yang valid.' });
        return;
      }

      const storedName = `manual_${crypto.randomUUID()}.pdf`;
      const targetPath = path.resolve(UPLOAD_DIR, storedName);
      if (!targetPath.startsWith(UPLOAD_DIR + path.sep)) {
        res.status(400).json({ error: 'Jalur penyimpanan tidak valid.' });
        return;
      }

      const oldStored = String(existing.manual_pdf_stored_name || '').trim();
      const now = new Date().toISOString();
      const safeOriginal = path.basename(file.originalname || 'Surat_Pindah.pdf').replace(/["\r\n]/g, '_');

      try {
        fs.writeFileSync(targetPath, file.buffer);
        db.prepare(`
          UPDATE letter_requests
          SET manual_pdf_name = ?, manual_pdf_stored_name = ?, manual_pdf_size = ?,
              manual_pdf_uploaded_at = ?, updated_at = ?
          WHERE id = ?
        `).run(safeOriginal, storedName, file.size, now, now, requestId);

        if (oldStored) {
          const oldPath = path.resolve(UPLOAD_DIR, path.basename(oldStored));
          if (oldPath.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(oldPath)) {
            try {
              fs.unlinkSync(oldPath);
            } catch {
              // ignore cleanup
            }
          }
        }
      } catch {
        if (fs.existsSync(targetPath)) {
          try {
            fs.unlinkSync(targetPath);
          } catch {
            // ignore cleanup
          }
        }
        res.status(500).json({ error: 'Gagal menyimpan file PDF surat manual.' });
        return;
      }

      const updated = db
        .prepare('SELECT * FROM letter_requests WHERE id = ?')
        .get(requestId) as Record<string, unknown>;
      res.json({ request: mapRequestRow(updated) });
    });
  });

  // Protected Serving of Manual Official Letter PDF (Student only when Disetujui; Staff anytime)
  app.get('/api/requests/:id/manual-letter-pdf', requireAuth, (req: AuthedRequest, res) => {
    const requestId = String(req.params.id || '');
    const existing = db
      .prepare('SELECT * FROM letter_requests WHERE id = ?')
      .get(requestId) as Record<string, unknown> | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Pengajuan surat tidak ditemukan.' });
      return;
    }

    if (req.auth?.role !== 'staff' && req.auth?.nim !== String(existing.student_nim)) {
      res.status(403).json({ error: 'Anda tidak berwenang mengakses dokumen surat ini.' });
      return;
    }

    if (req.auth?.role !== 'staff' && String(existing.status) !== 'Disetujui') {
      res.status(403).json({
        error: 'File PDF Surat Pindah baru dapat diunduh setelah berkas disetujui dan diterbitkan oleh staf.',
      });
      return;
    }

    const storedName = path.basename(String(existing.manual_pdf_stored_name || '').trim());
    if (!storedName) {
      res.status(404).json({ error: 'File PDF surat belum diunggah oleh staf.' });
      return;
    }

    const resolvedPath = path.resolve(UPLOAD_DIR, storedName);
    if (!resolvedPath.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
      res.status(404).json({ error: 'File PDF surat tidak ditemukan di penyimpanan.' });
      return;
    }

    const safeOriginal = path
      .basename(String(existing.manual_pdf_name || `Surat_Pindah_${existing.student_nim}.pdf`))
      .replace(/["\r\n]/g, '_');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeOriginal}"`);
    res.sendFile(resolvedPath);
  });

  // Protected File Serving with Path Confinement & Ownership Check
  app.get('/api/files/:docId', requireAuth, (req: AuthedRequest, res) => {
    const docId = String(req.params.docId || '');
    const doc = db
      .prepare(`
        SELECT d.*, lr.student_nim
        FROM request_documents d
        JOIN letter_requests lr ON lr.id = d.request_id
        WHERE d.id = ?
      `)
      .get(docId) as (Record<string, unknown> & { student_nim: string }) | undefined;

    if (!doc) {
      res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
      return;
    }

    if (req.auth?.role !== 'staff' && req.auth?.nim !== doc.student_nim) {
      res.status(403).json({ error: 'Anda tidak berwenang mengakses dokumen ini.' });
      return;
    }

    const storedName = path.basename(String(doc.stored_name));
    const resolvedPath = path.resolve(UPLOAD_DIR, storedName);
    if (!resolvedPath.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
      res.status(404).json({ error: 'File dokumen tidak ditemukan di penyimpanan.' });
      return;
    }

    const safeOriginal = String(doc.original_name || 'dokumen').replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', String(doc.mime_type || 'application/octet-stream'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${safeOriginal}"`);
    fs.createReadStream(resolvedPath).pipe(res);
  });

  // Vite / Static Frontend
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Portal Layanan Surat Mahasiswa running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
