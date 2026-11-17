/* GD LIVE STUDIO — public client configuration.
 * ONLY public values belong here. This file is served from GitHub Pages and is visible to everyone.
 * NEVER put OAuth client secrets, admin passwords, API keys, stream keys or HMAC secrets in this file.
 */
export const CONFIG = {
  APP_NAME: 'GD LIVE STUDIO',
  BRAND_NAME: 'GD TECH ACADEMY',
  TAGLINE: 'Create. Connect. Go Live.',
  VERSION: '1.0.0',
  WEBSITE: 'https://gyaankadabba.blogspot.com',
  HANDLE: '@GYAANKADABBA',

  // Paste your deployed Apps Script Web App URL (ends in /exec). Empty = "Local mode" (no backend features).
  API_URL: '',

  // Public OAuth client IDs (safe to publish; they are not secrets). Create them in Google Cloud / Meta for Developers.
  GOOGLE_CLIENT_ID: '',   // used for Google Sign-In, YouTube Live API and optional Drive (drive.file) access
  FACEBOOK_APP_ID: '',    // used for Facebook Login for eligible Pages
  FACEBOOK_GRAPH_VERSION: 'v21.0',

  // Default ICE servers used for WebRTC/WHIP. The owner can override via backend settings (AppSettings gateway.iceServers).
  DEFAULT_ICE_SERVERS: [{ urls: 'stun:stun.l.google.com:19302' }],

  // Session lifetime hint (the server is authoritative)
  SESSION_DAYS: 7,

  // Brand assets (permanent)
  LOGO_FULL: 'assets/logo/gd-tech-academy-logo.png',
  LOGO_MARK: 'assets/logo/gd-mark.png'
};

export const ROUTES_NAV = [
  { path: '/dashboard',   label: 'Dashboard',          icon: 'home',      group: 'main' },
  { path: '/go-live',     label: 'Start Streaming',    icon: 'radio',     group: 'main' },
  { path: '/studio',      label: 'Broadcast Studio',   icon: 'layers',    group: 'main' },
  { path: '/camera',      label: 'Camera Studio',      icon: 'camera',    group: 'main' },
  { path: '/record',      label: 'Recording Studio',   icon: 'circle',    group: 'main' },
  { path: '/platforms',   label: 'Platform Connections', icon: 'plug',    group: 'main' },
  { path: '/schedule',    label: 'Stream Scheduler',   icon: 'calendar',  group: 'main' },
  { path: '/overlays',    label: 'Branding & Overlays', icon: 'palette',  group: 'main' },
  { path: '/recordings',  label: 'My Recordings',      icon: 'film',      group: 'library' },
  { path: '/history',     label: 'My Stream History',  icon: 'clock',     group: 'library' },
  { path: '/devices',     label: 'Device Settings',    icon: 'settings',  group: 'system' },
  { path: '/storage',     label: 'Storage Manager',    icon: 'drive',     group: 'system' },
  { path: '/diagnostics', label: 'Diagnostics',        icon: 'activity',  group: 'system' },
  { path: '/help',        label: 'Help & Tutorials',   icon: 'help',      group: 'system' },
  { path: '/profile',     label: 'Profile & Account',  icon: 'user',      group: 'system' },
  { path: '/about',       label: 'About',              icon: 'info',      group: 'system' },
  { path: '/admin',       label: 'Admin Panel',        icon: 'shield',    group: 'admin', admin: true }
];
