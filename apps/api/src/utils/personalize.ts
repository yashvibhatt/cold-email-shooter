// Best-effort first-name lookup for follow-up personalization. We don't store
// structured contact fields (firstName/company) on EmailJob — campaigns bake
// them into the subject/body at schedule time — so we recover the name either
// from the original email's greeting line or, failing that, the email's local-part.

const GREETING_RE = /^(?:hi|hello|hey|dear)[,\s]+([A-Z][a-zA-Z'-]{1,20})\b/im;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function guessFirstName(originalBody: string | null | undefined, recipientEmail: string): string {
  if (originalBody) {
    const plainText = originalBody.replace(/<[^>]+>/g, ' ');
    const match = plainText.match(GREETING_RE);
    if (match) return titleCase(match[1]);
  }

  const localPart = recipientEmail.split('@')[0] ?? '';
  const firstToken = localPart.split(/[._+-]/)[0] ?? '';
  return firstToken ? titleCase(firstToken) : 'there';
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'aol.com', 'live.com', 'msn.com', 'protonmail.com', 'proton.me', 'me.com',
]);

// Second-level TLDs (co.uk, com.au, ...) where we need to strip two
// dot-segments instead of one to get the actual company name.
const TWO_PART_TLDS = new Set(['co', 'com', 'org', 'net', 'gov', 'ac']);

/**
 * Guesses a company name from the recipient's email domain, since we don't
 * store structured contact data for follow-ups. Returns null for personal
 * email providers where a domain-based guess wouldn't make sense.
 */
export function guessCompany(recipientEmail: string): string | null {
  const domain = recipientEmail.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return null;

  const parts = domain.split('.');
  const dropCount = parts.length > 2 && TWO_PART_TLDS.has(parts[parts.length - 2]) ? 2 : 1;
  const nameParts = parts.slice(0, Math.max(1, parts.length - dropCount));
  const name = nameParts.join(' ').replace(/[^a-zA-Z0-9\s]/g, ' ').trim();

  if (!name) return null;
  return name.split(/\s+/).map(titleCase).join(' ');
}

export function applyFollowUpTemplate(template: string, firstName: string, company: string | null): string {
  return template
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*company\s*\}\}/gi, company ?? 'your company');
}
