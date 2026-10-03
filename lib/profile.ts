/** Profile tabs, shared by the server page (which loads only the active tab) and the client UI. */
export const PROFILE_TABS = ['overview', 'bookmarks', 'history', 'following', 'notifications', 'achievements', 'settings'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
export const isProfileTab = (v: unknown): v is ProfileTab => (PROFILE_TABS as readonly unknown[]).includes(v);
