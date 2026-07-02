/**
 * Access-token signing. Payload shape matches the existing email/password login
 * ({ id, email, role, name }) so both auth paths issue interchangeable tokens
 * and the existing `authenticate` middleware keeps working.
 */
import jwt from 'jsonwebtoken';

export interface AccessTokenUser {
  id: string;
  email: string | null;
  role: string | null;
  name: string | null;
}

export function signAccessToken(
  user: AccessTokenUser,
  secret: string,
  expiresIn: string | number = '1h',
): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name, type: 'access' },
    secret,
    { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] },
  );
}
