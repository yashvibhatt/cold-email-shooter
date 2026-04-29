import fs from 'fs';
import path from 'path';
import { parse as parseCsv } from 'csv-parse';
import * as XLSX from 'xlsx';
import { emailRowSchema, validateColumns, REQUIRED_COLUMNS } from '../utils/validation';
import { ValidationError } from '../utils/validation';
import { logger } from '../utils/logger';

export interface ParsedRow {
  rowIndex: number;
  recipient_email: string;
  subject: string;
  body: string;
  send_date: string;
  send_time: string;
  timezone: string;
  status?: string;
  errors: string[];
  isValid: boolean;
}

export interface ParseResult {
  rows: ParsedRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  missingColumns: string[];
}

function normaliseHeaders(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    out[key.toLowerCase().trim()] = String(raw[key] ?? '').trim();
  }
  return out;
}

function validateRow(raw: Record<string, string>, rowIndex: number): ParsedRow {
  const result = emailRowSchema.safeParse(raw);

  if (result.success) {
    return {
      rowIndex,
      ...result.data,
      errors: [],
      isValid: true,
    };
  }

  const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
  return {
    rowIndex,
    recipient_email: raw.recipient_email ?? '',
    subject: raw.subject ?? '',
    body: raw.body ?? '',
    send_date: raw.send_date ?? '',
    send_time: raw.send_time ?? '',
    timezone: raw.timezone ?? 'UTC',
    status: raw.status,
    errors,
    isValid: false,
  };
}

async function parseFromRecords(
  records: Record<string, string>[]
): Promise<ParseResult> {
  if (records.length === 0) {
    throw new ValidationError('File contains no data rows');
  }

  const headers = Object.keys(records[0]);
  const missingColumns = validateColumns(headers);

  const rows: ParsedRow[] = records.map((record, i) =>
    validateRow(normaliseHeaders(record), i + 2) // +2 because row 1 = header
  );

  return {
    rows,
    totalRows: rows.length,
    validRows: rows.filter((r) => r.isValid).length,
    invalidRows: rows.filter((r) => !r.isValid).length,
    missingColumns,
  };
}

export async function parseCsvFile(filePath: string): Promise<ParseResult> {
  logger.debug('Parsing CSV file', { filePath });

  return new Promise((resolve, reject) => {
    const records: Record<string, string>[] = [];

    fs.createReadStream(filePath)
      .pipe(
        parseCsv({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
        })
      )
      .on('data', (row: Record<string, string>) => records.push(row))
      .on('error', (err) => reject(new ValidationError(`CSV parse error: ${err.message}`)))
      .on('end', async () => {
        try {
          resolve(await parseFromRecords(records));
        } catch (err) {
          reject(err);
        }
      });
  });
}

export async function parseExcelFile(filePath: string): Promise<ParseResult> {
  logger.debug('Parsing Excel file', { filePath });

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new ValidationError('Excel file has no sheets');
  }

  const sheet = workbook.Sheets[sheetName];
  const records: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  }) as Record<string, string>[];

  return parseFromRecords(records);
}

export async function parseUploadedFile(
  filePath: string,
  originalName: string
): Promise<ParseResult> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.csv') {
    return parseCsvFile(filePath);
  } else if (['.xlsx', '.xls'].includes(ext)) {
    return parseExcelFile(filePath);
  } else {
    throw new ValidationError(`Unsupported file type: ${ext}. Use .csv, .xlsx, or .xls`);
  }
}

// ─── Contacts parsing (Apollo, LinkedIn, generic) ─────────────────────────────

export interface ContactRow {
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  title: string;
  rowIndex: number;
}

export interface ContactsParseResult {
  contacts: ContactRow[];
  totalContacts: number;
  skippedRows: number;
  detectedFormat: string;
}

// Maps many common column name variants to a canonical key
const COLUMN_MAP: Record<string, string> = {
  // email
  'email': 'email',
  'email address': 'email',
  'primary email': 'email',
  'e-mail': 'email',
  'e-mail address': 'email',
  // first name
  'first name': 'firstName',
  'firstname': 'firstName',
  'first_name': 'firstName',
  'given name': 'firstName',
  // last name
  'last name': 'lastName',
  'lastname': 'lastName',
  'last_name': 'lastName',
  'surname': 'lastName',
  'family name': 'lastName',
  // company
  'company name': 'company',
  'company': 'company',
  'organization': 'company',
  'employer': 'company',
  'company name for emails': 'company',
  // title / role
  'title': 'title',
  'job title': 'title',
  'position': 'title',
  'role': 'title',
};

function mapHeaders(rawHeaders: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const h of rawHeaders) {
    const canonical = COLUMN_MAP[h.toLowerCase().trim()];
    if (canonical) mapping[canonical] = h; // canonical → original header
  }
  return mapping;
}

function detectFormat(headers: string[]): string {
  const lower = headers.map((h) => h.toLowerCase());
  if (lower.includes('apollo contact id')) return 'Apollo';
  if (lower.some((h) => h.includes('linkedin'))) return 'LinkedIn';
  if (lower.includes('email address')) return 'Generic (Email Address)';
  return 'Generic';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function extractContacts(records: Record<string, string>[]): ContactsParseResult {
  if (records.length === 0) throw new ValidationError('File contains no data rows');

  const headers = Object.keys(records[0]);
  const detectedFormat = detectFormat(headers);
  const mapping = mapHeaders(headers);

  if (!mapping.email) {
    throw new ValidationError(
      `No email column found. Expected one of: Email, Email Address, Primary Email. Found columns: ${headers.slice(0, 8).join(', ')}…`
    );
  }

  const contacts: ContactRow[] = [];
  let skippedRows = 0;

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const email = (row[mapping.email] ?? '').trim();

    if (!email || !isValidEmail(email)) {
      skippedRows++;
      continue;
    }

    const firstName = mapping.firstName ? (row[mapping.firstName] ?? '').trim() : '';
    const lastName  = mapping.lastName  ? (row[mapping.lastName]  ?? '').trim() : '';
    const company   = mapping.company   ? (row[mapping.company]   ?? '').trim() : '';
    const title     = mapping.title     ? (row[mapping.title]     ?? '').trim() : '';

    contacts.push({
      email,
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' '),
      company,
      title,
      rowIndex: i + 2,
    });
  }

  return {
    contacts,
    totalContacts: contacts.length,
    skippedRows,
    detectedFormat,
  };
}

export async function parseContactsCsvFile(filePath: string): Promise<ContactsParseResult> {
  return new Promise((resolve, reject) => {
    const records: Record<string, string>[] = [];
    fs.createReadStream(filePath)
      .pipe(parseCsv({ columns: true, skip_empty_lines: true, trim: true, bom: true }))
      .on('data', (row: Record<string, string>) => records.push(row))
      .on('error', (err) => reject(new ValidationError(`CSV parse error: ${err.message}`)))
      .on('end', () => {
        try { resolve(extractContacts(records)); }
        catch (err) { reject(err); }
      });
  });
}

export async function parseContactsExcelFile(filePath: string): Promise<ContactsParseResult> {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new ValidationError('Excel file has no sheets');
  const sheet = workbook.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) as Record<string, string>[];
  return extractContacts(records);
}

export async function parseContactsFile(
  filePath: string,
  originalName: string
): Promise<ContactsParseResult> {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.csv') return parseContactsCsvFile(filePath);
  if (['.xlsx', '.xls'].includes(ext)) return parseContactsExcelFile(filePath);
  throw new ValidationError(`Unsupported file type: ${ext}`);
}
