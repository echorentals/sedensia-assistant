import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/index.js';

const oauth2Client = new OAuth2Client();

interface VerificationResult {
  valid: boolean;
  error?: string;
  email?: string;
}

/**
 * Verify a Pub/Sub push authentication token.
 * Returns { valid: true, email } if valid, { valid: false, error } if invalid.
 */
export async function verifyPubSubToken(authHeader: string | undefined): Promise<VerificationResult> {
  // If no service account configured, skip verification (backward compatible)
  if (!env.PUBSUB_SERVICE_ACCOUNT) {
    return { valid: true };
  }

  if (!authHeader) {
    return { valid: false, error: 'Missing Authorization header' };
  }

  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { valid: false, error: 'Invalid Authorization header format' };
  }

  const token = match[1];

  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken: token,
      audience: undefined, // Skip audience check, or set to your webhook URL
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return { valid: false, error: 'Invalid token payload' };
    }

    const email = payload.email;

    // Verify the token is from the expected service account
    if (email !== env.PUBSUB_SERVICE_ACCOUNT) {
      return { valid: false, error: `Unexpected service account: ${email}` };
    }

    // Verify it's a service account (not a user)
    if (!payload.email_verified) {
      return { valid: false, error: 'Email not verified' };
    }

    return { valid: true, email };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token verification failed';
    return { valid: false, error: message };
  }
}
