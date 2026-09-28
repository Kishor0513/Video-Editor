// Local-only build: everything unlocked, no server. CapCut-desktop-in-browser.
export type Plan = 'free' | 'pro' | 'business';
export const OWNER_UNLOCKED = true;
let plan: Plan = 'business';
export const setPlan = (p: Plan) => { plan = p; };
export const getPlan = (): Plan => (OWNER_UNLOCKED ? 'business' : plan);
export const can = {
  export4k: () => true,
  premiumFX: () => true,
  cloud: () => true,
};
