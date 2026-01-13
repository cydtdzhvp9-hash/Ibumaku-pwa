// Consent handling for pre-play documents.
//
// Keys are versioned so we can invalidate consent when the meaning of documents changes.

export const CONSENT_SAFETY_KEY = 'ibumaku_consent_safety_v1';
export const CONSENT_TERMS_KEY = 'ibumaku_consent_terms_v1';
export const CONSENT_BLOCKED_KEY = 'ibumaku_consent_blocked';

export function hasSafetyConsent(): boolean {
  return localStorage.getItem(CONSENT_SAFETY_KEY) === '1';
}

export function hasTermsConsent(): boolean {
  return localStorage.getItem(CONSENT_TERMS_KEY) === '1';
}

export function isConsentBlocked(): boolean {
  return localStorage.getItem(CONSENT_BLOCKED_KEY) === '1';
}

export function setSafetyConsent(on: boolean) {
  if (on) {
    localStorage.setItem(CONSENT_SAFETY_KEY, '1');
    localStorage.setItem(CONSENT_SAFETY_KEY + '_at', String(Date.now()));
  } else {
    localStorage.removeItem(CONSENT_SAFETY_KEY);
    localStorage.removeItem(CONSENT_SAFETY_KEY + '_at');
  }
}

export function setTermsConsent(on: boolean) {
  if (on) {
    localStorage.setItem(CONSENT_TERMS_KEY, '1');
    localStorage.setItem(CONSENT_TERMS_KEY + '_at', String(Date.now()));
  } else {
    localStorage.removeItem(CONSENT_TERMS_KEY);
    localStorage.removeItem(CONSENT_TERMS_KEY + '_at');
  }
}

export function blockConsent() {
  localStorage.setItem(CONSENT_BLOCKED_KEY, '1');
}

export function clearConsentBlock() {
  localStorage.removeItem(CONSENT_BLOCKED_KEY);
}
