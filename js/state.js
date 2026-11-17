/* GD LIVE STUDIO — shared application state and safe defaults.
 * The defaults below are used when the backend is unreachable or not configured ("Local mode").
 * Nothing here is a secret.
 */
export const DEFAULT_PLATFORMS = [
  {
    id: 'youtube', name: 'YouTube', enabled: true, ingest: 'rtmp', needsGateway: true,
    method: 'OAuth 2.0 (Google) + YouTube Data API v3 / Live Streaming API',
    eligibility: 'Your channel must be verified and enabled for live streaming (activation can take up to 24 hours). YouTube age and policy rules apply to the channel owner.',
    instructions: [
      'Open Google Cloud Console, create/select a project and enable "YouTube Data API v3".',
      'Create an OAuth 2.0 Client ID (type: Web application) and add this website origin under Authorized JavaScript origins.',
      'Add the Client ID to js/config.js (GOOGLE_CLIENT_ID). Add yourself as a Test user while the consent screen is in Testing mode.',
      'In YouTube Studio, enable live streaming for the channel and wait for activation.',
      'Come back here and press Connect, then approve the YouTube permission.'
    ],
    apiMessage: ''
  },
  {
    id: 'facebook', name: 'Facebook', enabled: true, ingest: 'rtmp', needsGateway: true,
    method: 'Facebook Login + Meta Graph API (Page live videos)',
    eligibility: 'Requires a Facebook Page you manage and a Meta app with the publish_video / pages_manage_posts permissions. Apps in Development mode only work for people with a role on the app; everyone else needs Meta App Review.',
    instructions: [
      'Create an app at developers.facebook.com and add the "Facebook Login" product.',
      'Add this website origin to the app\'s allowed domains / JavaScript SDK settings.',
      'Put the App ID in js/config.js (FACEBOOK_APP_ID).',
      'For people outside your app\'s role list, submit the needed permissions for Meta App Review.',
      'Press Connect and choose the Page you want to stream to.'
    ],
    apiMessage: ''
  },
  {
    id: 'instagram', name: 'Instagram', enabled: true, ingest: 'rtmp', needsGateway: true,
    method: 'Instagram Live Producer (manual RTMP) — no public Live API',
    eligibility: 'Instagram does not offer a general public API for starting a Live. Only accounts that Instagram has given access to a live-production tool (Live Producer on desktop) receive an RTMP URL and key. If your account does not have it, this destination is unavailable.',
    instructions: [
      'Check whether Live Producer is available to your Instagram account (it is rolled out by Instagram and is not available to every account).',
      'If available, create a live in Live Producer and copy the stream URL and stream key.',
      'Paste them here as a manual destination. The key stays on this device and is sent only to your own gateway when you go live.',
      'This app cannot verify the Instagram live state; it will show "Sending (not verified)" instead of "Live".'
    ],
    apiMessage: 'Instagram Live is only available to accounts with an official live-production method.'
  },
  {
    id: 'rtmp', name: 'Custom RTMP / RTMPS', enabled: true, ingest: 'rtmp', needsGateway: true,
    method: 'Official RTMP/RTMPS ingest URL + stream key from the destination platform',
    eligibility: 'Any platform that documents a standard RTMP/RTMPS ingest (e.g. Twitch, Kick, LinkedIn Live for approved accounts, Restream-style services you already use). Follow that platform\'s rules.',
    instructions: ['Copy the platform\'s RTMP(S) server URL and stream key from its official dashboard.', 'Add it as a destination. The key is stored only on this device if you choose to remember it.'],
    apiMessage: ''
  },
  {
    id: 'whip', name: 'WebRTC / WHIP endpoint', enabled: true, ingest: 'whip', needsGateway: false,
    method: 'WHIP (WebRTC-HTTP Ingestion Protocol), direct from the browser',
    eligibility: 'Any server that exposes a WHIP endpoint (for example your own MediaMTX gateway, or a WHIP-capable service you already have access to).',
    instructions: ['Enter the WHIP endpoint URL (and bearer token if required).', 'Single-destination streaming works directly without a relay.'],
    apiMessage: ''
  }
];

export const DEFAULT_FEATURES = {
  camera_studio: true, recording: true, overlays: true, scheduler: true, multi_platform: true,
  drive_storage: true, guest_preview: true, registration: true, platform_youtube: true, platform_facebook: true, platform_instagram: true
};

export const state = {
  online: navigator.onLine,
  backend: 'unknown',            // 'unknown' | 'ok' | 'error' | 'not_configured'
  config: {
    appName: 'GD LIVE STUDIO',
    maintenance: false, maintenanceMessage: '',
    registrationOpen: true, requireApproval: true, guestAccess: true,
    storageLimitMb: 0,
    announcements: [],
    platforms: DEFAULT_PLATFORMS,
    features: { ...DEFAULT_FEATURES },
    gateway: { whipBase: '', relayApi: '', authType: 'bearer', iceServers: null, enabled: false },
    theme: 'auto'
  },
  user: null                     // { id, email, name, role, status, avatar, ageGroup }
};

export const isAdmin = () => state.user?.role === 'SuperAdmin' && state.user?.status === 'Active';
export const isUser = () => !!state.user && state.user.status === 'Active';
export const role = () => (isAdmin() ? 'admin' : isUser() ? 'user' : 'guest');
export const feature = key => state.config.features[key] !== false;
export const platformDef = id => state.config.platforms.find(p => p.id === id) || DEFAULT_PLATFORMS.find(p => p.id === id);

export function mergePublicConfig(c) {
  if (!c) return;
  const m = state.config;
  for (const key of ['appName', 'maintenance', 'maintenanceMessage', 'registrationOpen', 'requireApproval', 'guestAccess', 'storageLimitMb', 'theme']) if (c[key] !== undefined) m[key] = c[key];
  if (Array.isArray(c.announcements)) m.announcements = c.announcements;
  if (Array.isArray(c.platforms) && c.platforms.length) m.platforms = c.platforms;
  if (c.features) m.features = { ...DEFAULT_FEATURES, ...c.features };
  if (c.gateway) m.gateway = { ...m.gateway, ...c.gateway };
}
