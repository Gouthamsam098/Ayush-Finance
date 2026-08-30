/**
 * Client-side customer validation, mirroring the backend rules in
 * internal/domain/validate.go so users get instant per-field feedback. The
 * backend remains the source of truth (it re-validates every request); this
 * exists purely for UX. Keep the two in sync when rules change.
 */

import type { Customer } from '@/mock/DataContext';

export type FieldErrors = Partial<Record<string, string>>;

/** Official Indian states + union territories. Must match the backend list in
 *  internal/domain/india.go. Used for the State dropdown and validation. */
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam',
  'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
] as const;

const STATE_SET = new Set(INDIAN_STATES.map((s) => s.toLowerCase()));

const NAME_RE = /^[\p{L}][\p{L}\s.'-]*$/u;
const OCCUPATION_RE = /^[\p{L}][\p{L}\s&.,/()-]*$/u;
const CITY_RE = /^[\p{L}][\p{L}\s.-]*$/u;
const MOBILE_RE = /^[6-9]\d{9}$/;
const PINCODE_RE = /^[1-9]\d{5}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^[2-9]\d{11}$/;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PAN_HOLDER_TYPES = 'ABCFGHLJPTKE';
const MIN_AGE = 18;
const MAX_AGE = 100;
const MAX_INCOME = 100_00_00_000; // ₹100 crore

const trimmed = (v?: string) => (v ?? '').trim();
const present = (v?: string) => trimmed(v).length > 0;
const allSameDigit = (s: string) => s.length > 0 && [...s].every((c) => c === s[0]);

/** Mirror of the backend looksLikeGibberish: 4+ same char run, 5+ consonant
 *  run, or a 3+ letter word with no vowel. Blocks 'bgvfdfdsa', 'xxxx', etc. */
function looksLikeGibberish(s: string): boolean {
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]) { run++; if (run >= 4) return true; }
    else run = 1;
  }
  const isVowel = (c: string) => 'aeiouAEIOU'.includes(c);
  let letters = 0, consonantRun = 0, hasVowel = false;
  for (const c of s) {
    if (/[a-zA-Z]/.test(c)) {
      letters++;
      if (isVowel(c)) { hasVowel = true; consonantRun = 0; }
      else { consonantRun++; if (consonantRun >= 5) return true; }
    } else consonantRun = 0;
  }
  return letters >= 3 && !hasVowel;
}

function validName(label: string, v: string): string | undefined {
  const s = trimmed(v);
  if (!s) return `${label} is required`;
  if (s.length < 2) return `${label} is too short`;
  if (s.length > 100) return `${label} must be at most 100 characters`;
  if (!NAME_RE.test(s)) return `${label} may only contain letters, spaces, and . ' -`;
  if (looksLikeGibberish(s)) return `${label} does not look like a valid name`;
}

function validCity(v: string): string | undefined {
  const s = trimmed(v);
  if (!s) return 'city is required';
  if (s.length < 2) return 'city is too short';
  if (s.length > 50) return 'city must be at most 50 characters';
  if (!CITY_RE.test(s)) return 'city may only contain letters, spaces, and . -';
  if (looksLikeGibberish(s)) return 'city does not look like a valid name';
}

function validState(v: string): string | undefined {
  const s = trimmed(v);
  if (!s) return 'state is required';
  if (!STATE_SET.has(s.toLowerCase())) return 'state must be a valid Indian state or union territory';
}

function validMobile(label: string, v: string): string | undefined {
  const s = trimmed(v);
  if (!s) return `${label} is required`;
  if (!MOBILE_RE.test(s)) return `${label} must be a 10-digit number starting 6-9`;
  if (allSameDigit(s)) return `${label} is not a valid number`;
}

/** Verhoeff checksum — the UIDAI standard for Aadhaar validity. */
function verhoeffValid(num: string): boolean {
  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  let c = 0;
  for (let i = 0; i < num.length; i++) {
    const digit = num.charCodeAt(num.length - 1 - i) - 48;
    if (digit < 0 || digit > 9) return false;
    c = d[c][p[i % 8][digit]];
  }
  return c === 0;
}

function ageFromDob(dob: string, now: Date): number {
  const [y, m, day] = dob.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < day)) age--;
  return age;
}

/**
 * Validate the customer form. `hasKyc` indicates whether the customer already
 * has an Aadhaar/PAN on file (edit mode) — used to relax the "provide one KYC"
 * rule when the field is intentionally left blank to keep the existing value.
 */
export function validateCustomerForm(
  form: Partial<Customer>,
  opts: { hasKyc?: boolean } = {},
): FieldErrors {
  const e: FieldErrors = {};
  const now = new Date();

  e.name = validName('name', form.name ?? '');
  e.mobile = validMobile('mobile', form.mobile ?? '');

  if (!present(form.address)) e.address = 'address is required';
  else if (trimmed(form.address).length < 5) e.address = 'address is too short';
  else if (trimmed(form.address).length > 250) e.address = 'address must be at most 250 characters';

  e.city = validCity(form.city ?? '');
  e.state = validState(form.state ?? '');

  if (!present(form.pincode)) e.pincode = 'pincode is required';
  else if (!PINCODE_RE.test(trimmed(form.pincode))) e.pincode = 'pincode must be 6 digits and cannot start with 0';

  // Optional fields — validated only when filled.
  if (present(form.fatherName)) e.fatherName = validName("father's name", form.fatherName!);
  if (present(form.altMobile)) {
    e.altMobile = validMobile('alternate mobile', form.altMobile!)
      ?? (form.altMobile === form.mobile ? 'alternate mobile must differ from the primary mobile' : undefined);
  }
  if (present(form.referenceMobile)) e.referenceMobile = validMobile('reference mobile', form.referenceMobile!);
  if (present(form.referenceName)) e.referenceName = validName('reference name', form.referenceName!);

  if (present(form.occupation)) {
    const o = trimmed(form.occupation);
    if (o.length < 2) e.occupation = 'occupation is too short';
    else if (o.length > 60) e.occupation = 'occupation is too long';
    else if (!OCCUPATION_RE.test(o)) e.occupation = 'occupation may only contain letters, spaces, and & . , - / ( )';
  }

  if (present(form.email) && !EMAIL_RE.test(trimmed(form.email))) e.email = 'email is not a valid address';

  if (form.monthlyIncome != null) {
    if (form.monthlyIncome < 0) e.monthlyIncome = 'monthly income cannot be negative';
    else if (form.monthlyIncome > MAX_INCOME) e.monthlyIncome = 'monthly income is unrealistically high';
  }

  if (present(form.dateOfBirth)) {
    const dob = trimmed(form.dateOfBirth);
    const parsed = new Date(dob + 'T00:00:00');
    if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      e.dateOfBirth = 'date of birth must be a real date';
    } else if (parsed > now) {
      e.dateOfBirth = 'date of birth cannot be in the future';
    } else {
      const age = ageFromDob(dob, now);
      if (age < MIN_AGE) e.dateOfBirth = 'customer must be at least 18 years old';
      else if (age > MAX_AGE) e.dateOfBirth = 'date of birth implies an unrealistic age';
    }
  }

  // KYC. Values are entered without formatting; validate shape + checksum.
  if (present(form.aadhaar)) {
    const a = trimmed(form.aadhaar);
    if (!AADHAAR_RE.test(a)) e.aadhaar = 'Aadhaar must be 12 digits and cannot start with 0 or 1';
    else if (allSameDigit(a)) e.aadhaar = 'Aadhaar is not a valid number';
    else if (!verhoeffValid(a)) e.aadhaar = 'Aadhaar checksum is invalid';
  }
  if (present(form.pan)) {
    const p = trimmed(form.pan).toUpperCase();
    if (!PAN_RE.test(p)) e.pan = 'PAN must be in the format AAAAA9999A';
    else if (!PAN_HOLDER_TYPES.includes(p[3])) e.pan = 'PAN has an invalid holder-type character';
  }

  // KYC identifiers are OPTIONAL — a customer can be saved with neither an
  // Aadhaar nor a PAN, and they can be captured later. Mirrors the backend
  // (domain/customer.go), which is the authority.
  //
  // Note what did NOT change: the format checks above still run in full on any
  // value that IS entered (Aadhaar 12 digits + Verhoeff checksum; PAN
  // AAAAA9999A with a valid holder-type character). Optional means "may be
  // blank", never "accepted unvalidated".

  // Drop keys with no error so callers can check emptiness easily.
  for (const k of Object.keys(e)) if (!e[k]) delete e[k];
  return e;
}
