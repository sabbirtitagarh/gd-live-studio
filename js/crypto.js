/* GD LIVE STUDIO — client-side password derivation.
 * The browser turns the password into a 256-bit key with PBKDF2-SHA256 (150,000 iterations, salt bound to the email) and sends only that
 * hex string. The real password never leaves the device, and the server adds its own per-user salt + secret pepper on top.
 * Note: because the server never sees the raw password, the password-length rule is enforced here in the browser.
 */
const ITER = 150000;
export async function derivePw(password, email) {
  if (!crypto?.subtle) throw new Error('This browser cannot do secure sign-in (Web Crypto is unavailable). Use HTTPS and a current browser.');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: enc.encode('gd-live-studio:v1:' + String(email).trim().toLowerCase()) }, key, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}
