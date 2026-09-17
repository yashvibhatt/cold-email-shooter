// Best-effort location → IANA timezone resolver, built from a contact's
// city/state/country (as parsed out of Apollo/LinkedIn CSV exports).
// State-level mapping is used first (accurate for multi-timezone countries
// like the US/Canada/Australia); country-level is the fallback.

const US_STATE_TZ: Record<string, string> = {
  // Eastern
  'connecticut': 'America/New_York', 'ct': 'America/New_York',
  'delaware': 'America/New_York', 'de': 'America/New_York',
  'florida': 'America/New_York', 'fl': 'America/New_York',
  'georgia': 'America/New_York', 'ga': 'America/New_York',
  'maine': 'America/New_York', 'me': 'America/New_York',
  'maryland': 'America/New_York', 'md': 'America/New_York',
  'massachusetts': 'America/New_York', 'ma': 'America/New_York',
  'new hampshire': 'America/New_York', 'nh': 'America/New_York',
  'new jersey': 'America/New_York', 'nj': 'America/New_York',
  'new york': 'America/New_York', 'ny': 'America/New_York',
  'north carolina': 'America/New_York', 'nc': 'America/New_York',
  'ohio': 'America/New_York', 'oh': 'America/New_York',
  'pennsylvania': 'America/New_York', 'pa': 'America/New_York',
  'rhode island': 'America/New_York', 'ri': 'America/New_York',
  'south carolina': 'America/New_York', 'sc': 'America/New_York',
  'vermont': 'America/New_York', 'vt': 'America/New_York',
  'virginia': 'America/New_York', 'va': 'America/New_York',
  'washington dc': 'America/New_York', 'dc': 'America/New_York', 'district of columbia': 'America/New_York',
  'west virginia': 'America/New_York', 'wv': 'America/New_York',
  'michigan': 'America/New_York', 'mi': 'America/New_York',
  'indiana': 'America/New_York', 'in': 'America/New_York',
  // Central
  'alabama': 'America/Chicago', 'al': 'America/Chicago',
  'arkansas': 'America/Chicago', 'ar': 'America/Chicago',
  'illinois': 'America/Chicago', 'il': 'America/Chicago',
  'iowa': 'America/Chicago', 'ia': 'America/Chicago',
  'kansas': 'America/Chicago', 'ks': 'America/Chicago',
  'kentucky': 'America/Chicago', 'ky': 'America/Chicago',
  'louisiana': 'America/Chicago', 'la': 'America/Chicago',
  'minnesota': 'America/Chicago', 'mn': 'America/Chicago',
  'mississippi': 'America/Chicago', 'ms': 'America/Chicago',
  'missouri': 'America/Chicago', 'mo': 'America/Chicago',
  'nebraska': 'America/Chicago', 'ne': 'America/Chicago',
  'north dakota': 'America/Chicago', 'nd': 'America/Chicago',
  'oklahoma': 'America/Chicago', 'ok': 'America/Chicago',
  'south dakota': 'America/Chicago', 'sd': 'America/Chicago',
  'tennessee': 'America/Chicago', 'tn': 'America/Chicago',
  'texas': 'America/Chicago', 'tx': 'America/Chicago',
  'wisconsin': 'America/Chicago', 'wi': 'America/Chicago',
  // Mountain
  'arizona': 'America/Phoenix', 'az': 'America/Phoenix', // no DST
  'colorado': 'America/Denver', 'co': 'America/Denver',
  'idaho': 'America/Denver', 'id': 'America/Denver',
  'montana': 'America/Denver', 'mt': 'America/Denver',
  'new mexico': 'America/Denver', 'nm': 'America/Denver',
  'utah': 'America/Denver', 'ut': 'America/Denver',
  'wyoming': 'America/Denver', 'wy': 'America/Denver',
  // Pacific
  'california': 'America/Los_Angeles', 'ca': 'America/Los_Angeles',
  'nevada': 'America/Los_Angeles', 'nv': 'America/Los_Angeles',
  'oregon': 'America/Los_Angeles', 'or': 'America/Los_Angeles',
  'washington': 'America/Los_Angeles', 'wa': 'America/Los_Angeles',
  // Alaska / Hawaii
  'alaska': 'America/Anchorage', 'ak': 'America/Anchorage',
  'hawaii': 'Pacific/Honolulu', 'hi': 'Pacific/Honolulu',
};

const CANADA_PROVINCE_TZ: Record<string, string> = {
  'ontario': 'America/Toronto', 'on': 'America/Toronto',
  'quebec': 'America/Toronto', 'qc': 'America/Toronto',
  'nova scotia': 'America/Halifax', 'ns': 'America/Halifax',
  'new brunswick': 'America/Halifax', 'nb': 'America/Halifax',
  'manitoba': 'America/Winnipeg', 'mb': 'America/Winnipeg',
  'saskatchewan': 'America/Regina', 'sk': 'America/Regina',
  'alberta': 'America/Edmonton', 'ab': 'America/Edmonton',
  'british columbia': 'America/Vancouver', 'bc': 'America/Vancouver',
  'newfoundland': 'America/St_Johns', 'nl': 'America/St_Johns',
  'yukon': 'America/Whitehorse', 'yt': 'America/Whitehorse',
};

const AUSTRALIA_STATE_TZ: Record<string, string> = {
  'new south wales': 'Australia/Sydney', 'nsw': 'Australia/Sydney',
  'victoria': 'Australia/Melbourne', 'vic': 'Australia/Melbourne',
  'queensland': 'Australia/Brisbane', 'qld': 'Australia/Brisbane',
  'western australia': 'Australia/Perth', 'wa': 'Australia/Perth',
  'south australia': 'Australia/Adelaide', 'sa': 'Australia/Adelaide',
  'tasmania': 'Australia/Hobart', 'tas': 'Australia/Hobart',
  'northern territory': 'Australia/Darwin', 'nt': 'Australia/Darwin',
  'australian capital territory': 'Australia/Sydney', 'act': 'Australia/Sydney',
};

const COUNTRY_TZ: Record<string, string> = {
  'united states': 'America/New_York', 'usa': 'America/New_York', 'us': 'America/New_York',
  'united states of america': 'America/New_York',
  'canada': 'America/Toronto',
  'united kingdom': 'Europe/London', 'uk': 'Europe/London', 'england': 'Europe/London',
  'scotland': 'Europe/London', 'wales': 'Europe/London', 'great britain': 'Europe/London',
  'ireland': 'Europe/Dublin',
  'france': 'Europe/Paris',
  'germany': 'Europe/Berlin',
  'spain': 'Europe/Madrid',
  'italy': 'Europe/Rome',
  'netherlands': 'Europe/Amsterdam',
  'belgium': 'Europe/Brussels',
  'switzerland': 'Europe/Zurich',
  'portugal': 'Europe/Lisbon',
  'sweden': 'Europe/Stockholm',
  'norway': 'Europe/Oslo',
  'denmark': 'Europe/Copenhagen',
  'finland': 'Europe/Helsinki',
  'poland': 'Europe/Warsaw',
  'austria': 'Europe/Vienna',
  'greece': 'Europe/Athens',
  'romania': 'Europe/Bucharest',
  'czech republic': 'Europe/Prague', 'czechia': 'Europe/Prague',
  'india': 'Asia/Kolkata',
  'united arab emirates': 'Asia/Dubai', 'uae': 'Asia/Dubai',
  'saudi arabia': 'Asia/Riyadh',
  'israel': 'Asia/Jerusalem',
  'singapore': 'Asia/Singapore',
  'japan': 'Asia/Tokyo',
  'china': 'Asia/Shanghai',
  'hong kong': 'Asia/Hong_Kong',
  'south korea': 'Asia/Seoul', 'korea': 'Asia/Seoul',
  'taiwan': 'Asia/Taipei',
  'philippines': 'Asia/Manila',
  'indonesia': 'Asia/Jakarta',
  'malaysia': 'Asia/Kuala_Lumpur',
  'thailand': 'Asia/Bangkok',
  'vietnam': 'Asia/Ho_Chi_Minh',
  'pakistan': 'Asia/Karachi',
  'bangladesh': 'Asia/Dhaka',
  'new zealand': 'Pacific/Auckland',
  'brazil': 'America/Sao_Paulo',
  'mexico': 'America/Mexico_City',
  'argentina': 'America/Argentina/Buenos_Aires',
  'colombia': 'America/Bogota',
  'chile': 'America/Santiago',
  'south africa': 'Africa/Johannesburg',
  'nigeria': 'Africa/Lagos',
  'kenya': 'Africa/Nairobi',
  'egypt': 'Africa/Cairo',
  'turkey': 'Europe/Istanbul',
  'russia': 'Europe/Moscow',
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\./g, '');
}

/**
 * Resolves an IANA timezone from a contact's city/state/country strings.
 * Returns null when nothing in the location can be matched.
 */
export function resolveTimezone(state?: string, country?: string): string | null {
  const s = state ? norm(state) : '';
  const c = country ? norm(country) : '';

  // No country specified (or it's actually a US state written in the country column,
  // common in Apollo exports) — try US/Canada/Australia state tables directly.
  if (s && US_STATE_TZ[s] && (!c || c === 'united states' || c === 'usa' || c === 'us')) {
    return US_STATE_TZ[s];
  }
  if (s && CANADA_PROVINCE_TZ[s] && (!c || c === 'canada')) {
    return CANADA_PROVINCE_TZ[s];
  }
  if (s && AUSTRALIA_STATE_TZ[s] && (!c || c === 'australia')) {
    return AUSTRALIA_STATE_TZ[s];
  }

  if (c && COUNTRY_TZ[c]) return COUNTRY_TZ[c];

  // Some CSVs put the country in the state column
  if (s && COUNTRY_TZ[s]) return COUNTRY_TZ[s];

  return null;
}

// Splits a combined "City, State, Country" location string (as produced by
// the backend's fileParser) back into pieces we can look up.
export function resolveTimezoneFromLocation(location: string): string | null {
  if (!location) return null;
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const country = parts[parts.length - 1];
  const state   = parts.length >= 2 ? parts[parts.length - 2] : '';
  return resolveTimezone(state, country) ?? resolveTimezone('', country) ?? resolveTimezone(state, '');
}
