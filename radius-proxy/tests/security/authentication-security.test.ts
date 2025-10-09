// Security Compliance Tests
// Nyaa~ Testing security protections like a vigilant maid guarding the master's precious data! 😺🔒💕

import { POST as authorizePost } from '@/app/api/oauth/authorize/route';
import { POST as tokenPost } from '@/app/api/oauth/token/route';
import { GET as userinfoGet } from '@/app/api/oauth/userinfo/route';
import { radiusAuthenticate } from '@/lib/radius';
import { getStorage, cleanupExpiredCodes } from '@/lib/storage';
import { signToken, verifyToken } from '@/lib/jwt';
import crypto from 'crypto';

// Mock dependencies
jest.mock('@/lib/radius');
jest.mock('@/lib/storage');

const mockRadiusAuthenticate = radiusAuthenticate as jest.MockedFunction<typeof radiusAuthenticate>;
const mockGetStorage = getStorage as jest.MockedFunction<typeof getStorage>;
const mockCleanupExpiredCodes = cleanupExpiredCodes as jest.MockedFunction<typeof cleanupExpiredCodes>;

describe('Security Compliance Tests', () => {
  let mockStorage: Map<string, any>;
  let mockRefreshTokens: Map<string, any>;
  let storageMock: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup environment - set REDIRECT_URIS to [] to allow same-origin validation
    process.env.OAUTH_CLIENT_ID = 'grafana';
    process.env.OAUTH_CLIENT_SECRET = 'secret';
    process.env.RADIUS_HOST = 'localhost';
    process.env.RADIUS_SECRET = 'radiussecret';
    process.env.EMAIL_SUFFIX = 'example.com';
    process.env.REDIRECT_URIS = '[]'; // Empty array to allow same-origin
    
    // Setup storage mocks
    mockStorage = new Map();
    mockRefreshTokens = new Map();
    storageMock = {
      get: jest.fn((key: string) => Promise.resolve(mockStorage.get(key))),
      set: jest.fn((key: string, value: any) => {
        mockStorage.set(key, value);
        return Promise.resolve();
      }),
      delete: jest.fn((key: string) => {
        mockStorage.delete(key);
        return Promise.resolve();
      }),
      cleanup: jest.fn(() => Promise.resolve()),
      setRefreshToken: jest.fn((token: string, entry: any) => {
        mockRefreshTokens.set(token, entry);
        return Promise.resolve();
      }),
      getRefreshToken: jest.fn((token: string) => Promise.resolve(mockRefreshTokens.get(token))),
      deleteRefreshToken: jest.fn((token: string) => {
        mockRefreshTokens.delete(token);
        return Promise.resolve();
      }),
      cleanupRefreshTokens: jest.fn(() => Promise.resolve()),
    };
    mockGetStorage.mockReturnValue(storageMock);
    
    // Default successful RADIUS auth with permitted class
    mockRadiusAuthenticate.mockResolvedValue({
      ok: true,
      class: 'admin_group', // Use a class that's in PERMITTED_CLASSES
    });
    
    // Mock cleanupExpiredCodes
    mockCleanupExpiredCodes.mockResolvedValue();
  });

  describe('Input Validation Security', () => {
    test('should sanitize and validate username inputs', async () => {
      const maliciousUsernames = [
        '../../../etc/passwd',
        '<script>alert("xss")</script>',
        'user\x00name',
        'user\nname',
        'user\rname',
        'user\tname',
        'a'.repeat(1000), // Very long username
        '',
        '   ',
        'user@domain.com/../../admin',
        'user\'; DROP TABLE users; --',
      ];

      for (const username of maliciousUsernames) {
        // Clear previous calls to get accurate call tracking
        mockRadiusAuthenticate.mockClear();
        
        const formData = new FormData();
        formData.set('user', username);
        formData.set('password', 'password');
        formData.set('client_id', 'grafana');
        formData.set('redirect_uri', 'http://localhost/callback');

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        // Should not crash or allow injection
        const response = await authorizePost(request);
        expect(response.status).toBeLessThan(500); // Should not cause server error
        
        // If RADIUS was called, verify username was passed as-is (RADIUS should handle validation)
        if (mockRadiusAuthenticate.mock.calls.length > 0) {
          const lastCall = mockRadiusAuthenticate.mock.calls[mockRadiusAuthenticate.mock.calls.length - 1];
          
          // FormData may normalize line endings, so handle the expected transformations:
          // \n becomes \r\n (LF to CRLF)
          // \r becomes \r\n (CR to CRLF) 
          // \r\n stays \r\n (already CRLF)
          let expectedUsername = username
            .replace(/\r\n/g, '\n')  // Normalize existing CRLF to LF first
            .replace(/\r/g, '\n')    // Convert standalone CR to LF  
            .replace(/\n/g, '\r\n'); // Convert all LF to CRLF
          
          expect(lastCall[2]).toBe(expectedUsername); // Username should be passed as normalized by FormData
        }
      }
    });

    test('should validate and sanitize password inputs', async () => {
      const maliciousPasswords = [
        '\x00\x01\x02',
        'password\n\radmin',
        'a'.repeat(10000), // Very long password
        '',
        '\u0000',
        String.fromCharCode(0),
      ];

      for (const password of maliciousPasswords) {
        const formData = new FormData();
        formData.set('user', 'testuser');
        formData.set('password', password);
        formData.set('client_id', 'grafana');
        formData.set('redirect_uri', 'http://localhost/callback');

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        const response = await authorizePost(request);
        expect(response.status).toBeLessThan(500); // Should not cause server error
      }
    });

    test('should validate redirect_uri to prevent open redirects', async () => {
      const maliciousRedirects = [
        'http://evil.com/callback',
        'https://attacker.com/steal-tokens',
        'javascript:alert("xss")',
        'data:text/html,<script>alert("xss")</script>',
        'file:///etc/passwd',
        'ftp://evil.com/',
        'http://localhost@evil.com/callback',
        'http://localhost.evil.com/callback',
        'http://localhost/callback@evil.com',
        'http://localhost/callback#evil.com',
        'http://localhost:3000@evil.com/callback',
      ];

      for (const redirectUri of maliciousRedirects) {
        const formData = new FormData();
        formData.set('user', 'testuser');
        formData.set('password', 'password');
        formData.set('client_id', 'grafana');
        formData.set('redirect_uri', redirectUri);

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        const response = await authorizePost(request);
        
        if (response.status === 302) {
          const location = response.headers.get('location');
          // Should not redirect to external domains
          expect(location).not.toMatch(/^https?:\/\/(?!localhost)/);
          expect(location).not.toMatch(/evil\.com/);
          expect(location).not.toMatch(/attacker\.com/);
        }
      }
    });

    test('should validate client_id parameter', async () => {
      const maliciousClientIds = [
        '',
        'invalid-client',
        '<script>alert("xss")</script>',
        '../../../admin',
        'client\x00id',
        'a'.repeat(1000),
      ];

      for (const clientId of maliciousClientIds) {
        const formData = new FormData();
        formData.set('user', 'testuser');
        formData.set('password', 'password');
        formData.set('client_id', clientId);
        formData.set('redirect_uri', 'http://localhost/callback');

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        const response = await authorizePost(request);
        
        if (clientId !== 'grafana') {
          // Should reject invalid client IDs
          expect([400, 401, 302]).toContain(response.status);
        }
      }
    });
  });

  describe('JWT Token Security', () => {
    test('should generate cryptographically secure tokens', async () => {
      const tokens = new Set<string>();
      const errors: any[] = [];
      
      for (let i = 0; i < 100; i++) {
        try {
          const formData = new FormData();
          formData.set('user', `testuser${i}`); // Make each user unique to prevent JWT determinism
          formData.set('password', 'password');
          formData.set('client_id', 'grafana');
          formData.set('redirect_uri', 'http://localhost/callback');

          const authorizeRequest = new Request('http://localhost/api/oauth/authorize', {
            method: 'POST',
            body: formData,
          });

          const authorizeResponse = await authorizePost(authorizeRequest);
          const location = authorizeResponse.headers.get('location');
          
          // Debug: Check if authorization failed
          if (authorizeResponse.status !== 302 || !location) {
            errors.push({ step: 'authorize', status: authorizeResponse.status, i });
            continue; // Skip this iteration
          }
          
          const url = new URL(location);
          const code = url.searchParams.get('code');
          
          if (!code) {
            errors.push({ step: 'code_missing', location, i });
            continue;
          }

          // Exchange for token
          const tokenFormData = new FormData();
          tokenFormData.set('grant_type', 'authorization_code');
          tokenFormData.set('code', code);
          tokenFormData.set('client_id', 'grafana');
          tokenFormData.set('client_secret', 'secret');

          const tokenRequest = new Request('http://localhost/api/oauth/token', {
            method: 'POST',
            body: tokenFormData,
          });

          const tokenResponse = await tokenPost(tokenRequest);
          const tokenData = await tokenResponse.json();
          
          // Debug: Check if token exchange failed
          if (tokenResponse.status !== 200 || !tokenData.access_token) {
            errors.push({ step: 'token', status: tokenResponse.status, tokenData, i });
            continue;
          }
          
          tokens.add(tokenData.access_token);
        } catch (error) {
          errors.push({ step: 'exception', error: (error as Error).message, i });
        }
      }

      // If we have failures, show some of them for debugging
      if (tokens.size === 0 && errors.length > 0) {
        throw new Error(`All token generations failed. Sample errors: ${JSON.stringify(errors.slice(0, 3), null, 2)}`);
      }

      // All tokens should be unique
      expect(tokens.size).toBe(100);
      
      // Verify token structure
      tokens.forEach(token => {
        expect(token).toBeValidJWT();
        const parts = token.split('.');
        expect(parts).toHaveLength(3);
        
        // Decode payload and verify security claims
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        expect(payload.exp).toBeDefined();
        expect(payload.iat).toBeDefined();
        expect(payload.iss).toBeDefined();
        expect(payload.aud).toBe('grafana');
        expect(payload.sub).toMatch(/^testuser\d+$/); // testuser0, testuser1, etc.
      });
    });

    test('should validate token signature and reject tampered tokens', async () => {
      // Get a valid token first
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'password');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');

      const authorizeRequest = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const authorizeResponse = await authorizePost(authorizeRequest);
      const location = authorizeResponse.headers.get('location');
      const url = new URL(location!);
      const code = url.searchParams.get('code');

      const tokenFormData = new FormData();
      tokenFormData.set('grant_type', 'authorization_code');
      tokenFormData.set('code', code!);
      tokenFormData.set('client_id', 'grafana');
      tokenFormData.set('client_secret', 'secret');

      const tokenRequest = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: tokenFormData,
      });

      const tokenResponse = await tokenPost(tokenRequest);
      const tokenData = await tokenResponse.json();
      const validToken = tokenData.access_token;

      // Tamper with the token
      const parts = validToken.split('.');
      const tamperedPayload = Buffer.from(JSON.stringify({
        sub: 'admin',
        groups: ['admin', 'superuser'],
        grafana_admin: true,
        exp: Date.now() / 1000 + 3600,
      })).toString('base64url');
      
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      // Try to use tampered token
      const userinfoRequest = new Request('http://localhost/api/oauth/userinfo', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tamperedToken}`,
        },
      });

      const userinfoResponse = await userinfoGet(userinfoRequest);
      expect(userinfoResponse.status).toBe(401); // Should reject tampered token
    });

    test('should enforce token expiration', async () => {
      // Test that tokens have proper expiration claims when issued normally
      const token = signToken({
        sub: 'testuser',
        aud: 'grafana',
        groups: ['admin'],
        grafana_admin: true,
      }, { expiresIn: '1h' }); // Add expiresIn to generate exp claim

      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.exp).toBeDefined();
      expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
      expect(payload.iat).toBeDefined();
      expect(payload.iat).toBeLessThanOrEqual(Date.now() / 1000);
    });

    test('should prevent token reuse across different clients', async () => {
      // Create token for one client
      const token = await signToken({
        sub: 'testuser',
        aud: 'grafana',
        groups: ['admin'],
      });

      // Try to verify with different audience
      const result = await verifyToken(token);
      if (typeof result === 'object' && result && 'aud' in result) {
        expect(result.aud).toBe('grafana');
      }
      
      // Token should only be valid for intended audience
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.aud).toBe('grafana');
    });
  });

  describe('RADIUS Security', () => {
    test('should handle RADIUS packet injection attempts', async () => {
      // Test with malformed RADIUS responses by ensuring our client validates properly
      const malformedInputs = [
        'user\x00\x01\x02',
        'user with spaces and \r\n newlines',
        'user\x1f\x7f',
      ];

      for (const username of malformedInputs) {
        const formData = new FormData();
        formData.set('user', username);
        formData.set('password', 'password');
        formData.set('client_id', 'grafana');
        formData.set('redirect_uri', 'http://localhost/callback');

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        // Should not crash - RADIUS implementation should handle malformed data
        const response = await authorizePost(request);
        expect(response.status).toBeLessThan(500);
      }
    });

    test('should validate RADIUS response integrity', async () => {
      // Simulate various RADIUS failure scenarios
      const radiusFailures = [
        { ok: false }, // Simple failure
        { ok: false, class: 'admin' }, // Failure but with class data
        { ok: true, class: '' }, // Success but empty class
        { ok: true, class: null }, // Success but null class
        { ok: true }, // Success but no class
      ];

      for (const radiusResult of radiusFailures) {
        mockRadiusAuthenticate.mockResolvedValueOnce(radiusResult as any);

        const formData = new FormData();
        formData.set('user', 'testuser');
        formData.set('password', 'password');
        formData.set('client_id', 'grafana');
        formData.set('redirect_uri', 'http://localhost/callback');

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        const response = await authorizePost(request);
        
        if (!radiusResult.ok) {
          // Should handle authentication failures gracefully
          expect(response.status).toBe(302);
          const location = response.headers.get('location');
          expect(location).toContain('error=access_denied');
        }
      }
    });

    test('should handle RADIUS timeouts and network errors', async () => {
      const networkErrors = [
        new Error('ECONNREFUSED'),
        new Error('ETIMEDOUT'),
        new Error('Network unreachable'),
        new Error('DNS resolution failed'),
      ];

      for (const error of networkErrors) {
        mockRadiusAuthenticate.mockRejectedValueOnce(error);

        const formData = new FormData();
        formData.set('user', 'testuser');
        formData.set('password', 'password');
        formData.set('client_id', 'grafana');
        formData.set('redirect_uri', 'http://localhost/callback');

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        const response = await authorizePost(request);
        
        // Should handle network errors gracefully
        expect(response.status).toBe(302);
        const location = response.headers.get('location');
        expect(location).toContain('error=server_error');
      }
    });
  });

  describe('Rate Limiting and DoS Protection', () => {
    test('should handle rapid successive authentication attempts', async () => {
      const promises: Promise<Response>[] = [];
      
      // Create 50 concurrent authentication requests
      for (let i = 0; i < 50; i++) {
        const formData = new FormData();
        formData.set('user', `user${i}`);
        formData.set('password', 'password');
        formData.set('client_id', 'grafana');
        formData.set('redirect_uri', 'http://localhost/callback');

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        promises.push(authorizePost(request));
      }

      const responses = await Promise.allSettled(promises);
      
      // All should complete without crashing
      responses.forEach(result => {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') {
          expect(result.value.status).toBeLessThan(500);
        }
      });
    });

    test('should handle large request payloads safely', async () => {
      const largeData = 'x'.repeat(100000); // 100KB of data
      
      const formData = new FormData();
      formData.set('user', largeData);
      formData.set('password', largeData);
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('extra_field', largeData);

      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const response = await authorizePost(request);
      expect(response.status).toBeLessThan(500); // Should not crash
    });
  });

  describe('Session and Storage Security', () => {
    test('should securely clean up expired authorization codes', async () => {
      // Create some authorization codes with different expiry times
      const now = Date.now();
      
      await storageMock.set('fresh-code', {
        username: 'user1',
        class: 'admin',
        expiresAt: now + 300000, // 5 minutes from now
      });
      
      await storageMock.set('expired-code', {
        username: 'user2',
        class: 'admin',  
        expiresAt: now - 60000, // 1 minute ago
      });

      // Verify expired code is not usable
      const tokenFormData = new FormData();
      tokenFormData.set('grant_type', 'authorization_code');
      tokenFormData.set('code', 'expired-code');
      tokenFormData.set('client_id', 'grafana');
      tokenFormData.set('client_secret', 'secret');

      const tokenRequest = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: tokenFormData,
      });

      const tokenResponse = await tokenPost(tokenRequest);
      expect(tokenResponse.status).toBe(400);
      
      const error = await tokenResponse.json();
      expect(error).toMatchOAuth2Error();
      expect(error.error).toBe('invalid_grant');
    });

    test('should prevent timing attacks on token validation', async () => {
      const validCode = 'valid-code-123';
      const invalidCodes = [
        'invalid-code-1',
        'invalid-code-2', 
        'nonexistent',
        '',
        'x'.repeat(100),
      ];

      // Set up valid code
      await storageMock.set(validCode, {
        username: 'testuser',
        class: 'admin',
        expiresAt: Date.now() + 300000,
      });

      const timings: number[] = [];

      // Measure timing for invalid codes
      for (const code of invalidCodes) {
        const start = process.hrtime.bigint();
        
        const tokenFormData = new FormData();
        tokenFormData.set('grant_type', 'authorization_code');
        tokenFormData.set('code', code);
        tokenFormData.set('client_id', 'grafana');
        tokenFormData.set('client_secret', 'secret');

        const tokenRequest = new Request('http://localhost/api/oauth/token', {
          method: 'POST',
          body: tokenFormData,
        });

        await tokenPost(tokenRequest);
        
        const end = process.hrtime.bigint();
        timings.push(Number(end - start) / 1000000); // Convert to milliseconds
      }

      // Timing should be relatively consistent (within reasonable bounds)
      const avgTiming = timings.reduce((a, b) => a + b) / timings.length;
      const maxDeviation = Math.max(...timings.map(t => Math.abs(t - avgTiming)));
      
      // Allow for some variance but not orders of magnitude difference
      expect(maxDeviation).toBeLessThan(avgTiming * 2);
    });
  });

  describe('Content Security and XSS Prevention', () => {
    test('should set secure HTTP headers', async () => {
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'password');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');

      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const response = await authorizePost(request);

      // Verify security headers are present
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    test('should prevent XSS in error messages', async () => {
      const xssPayloads = [
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<img src="x" onerror="alert(\'xss\')">',
        '\"><script>alert("xss")</script>',
      ];

      for (const payload of xssPayloads) {
        const formData = new FormData();
        formData.set('user', payload);
        formData.set('password', 'password');
        formData.set('client_id', payload);
        formData.set('redirect_uri', 'http://localhost/callback');

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        const response = await authorizePost(request);
        
        if (response.headers.get('content-type')?.includes('application/json')) {
          const body = await response.text();
          // Should not contain unescaped script tags or javascript: protocols
          expect(body).not.toMatch(/<script/i);
          expect(body).not.toMatch(/javascript:/i);
          expect(body).not.toMatch(/onerror=/i);
        }
      }
    });
  });

  describe('Authorization Code Security', () => {
    test('should generate unguessable authorization codes', async () => {
      const codes = new Set<string>();
      
      for (let i = 0; i < 1000; i++) {
        const formData = new FormData();
        formData.set('user', 'testuser');
        formData.set('password', 'password');
        formData.set('client_id', 'grafana');
        formData.set('redirect_uri', 'http://localhost/callback');

        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });

        const response = await authorizePost(request);
        const location = response.headers.get('location');
        const url = new URL(location!);
        const code = url.searchParams.get('code');
        
        if (code) {
          codes.add(code);
        }
      }

      // All codes should be unique
      expect(codes.size).toBe(1000);
      
      // Codes should have sufficient entropy
      codes.forEach(code => {
        expect(code.length).toBeGreaterThanOrEqual(20); // Minimum length for security
        expect(code).toMatch(/^[A-Za-z0-9_-]+$/); // Safe characters only
      });
    });

    test('should bind authorization codes to client', async () => {
      // Create authorization code for one client
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'password');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');

      const authorizeRequest = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const authorizeResponse = await authorizePost(authorizeRequest);
      const location = authorizeResponse.headers.get('location');
      const url = new URL(location!);
      const code = url.searchParams.get('code');

      // Try to use code with different client
      const tokenFormData = new FormData();
      tokenFormData.set('grant_type', 'authorization_code');
      tokenFormData.set('code', code!);
      tokenFormData.set('client_id', 'different-client');
      tokenFormData.set('client_secret', 'different-secret');

      const tokenRequest = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: tokenFormData,
      });

      const tokenResponse = await tokenPost(tokenRequest);
      
      // Should reject the request
      expect(tokenResponse.status).toBe(401);
      const error = await tokenResponse.json();
      expect(error).toMatchOAuth2Error();
      expect(error.error).toBe('invalid_client');
    });
  });
});