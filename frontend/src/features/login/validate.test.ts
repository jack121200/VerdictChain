import { describe, expect, it } from 'vitest';
import { validateCredentials } from './validate';

describe('validateCredentials', () => {
  it('accepts a username of 3 characters and a password of 8', () => {
    expect(validateCredentials('abc', '12345678')).toBeNull();
  });

  it('asks for a longer username first', () => {
    expect(validateCredentials('ab', 'short')).toBe('Username must be at least 3 characters.');
  });

  it('asks for a longer password when the username is fine', () => {
    expect(validateCredentials('analyst', '1234567')).toBe('Password must be at least 8 characters.');
  });
});
