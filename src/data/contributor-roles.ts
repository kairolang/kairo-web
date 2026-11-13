/**
 * Roles shown on contributor cards, keyed by lowercase GitHub login. Kept out
 * of contributors.json, which generate-contributors.mjs overwrites.
 */
export const CONTRIBUTOR_ROLES: Record<string, string> = {
  ze7111: 'Creator and lead developer',
  ojastalgaonkar: 'Core developer',
  jrcarl624: 'Former developer, early language work',
};

export const roleOf = (login: string): string | undefined => CONTRIBUTOR_ROLES[login.toLowerCase()];
