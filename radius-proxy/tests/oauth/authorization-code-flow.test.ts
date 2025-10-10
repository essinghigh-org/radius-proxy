// OAuth2 RFC 6749 Authorization Code Flow Compliance Tests

import { POST as authorizePost, GET as authorizeGet } from '@/app/api/oauth/authorize/route';
import { POST as tokenPost } from '@/app/api/oauth/token/route';
import { radiusAuthenticate } from '@/lib/radius';
import { getStorage, cleanupExpiredCodes } from '@/lib/storage';
import { _invalidateConfigCache } from '@/lib/config';
import crypto from 'crypto';

// Mock RADIUS authentication
jest.mock('@/lib/radius');
const mockRadiusAuthenticate = radiusAuthenticate as jest.MockedFunction<typeof radiusAuthenticate>;

// Mock storage
jest.mock('@/lib/storage');
const mockGetStorage = getStorage as jest.MockedFunction<typeof getStorage>;
const mockCleanupExpiredCodes = cleanupExpiredCodes as jest.MockedFunction<typeof cleanupExpiredCodes>;

describe('OAuth2 RFC 6749 - Authorization Code Flow Compliance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup environment
    process.env.OAUTH_CLIENT_ID = 'grafana';
    process.env.OAUTH_CLIENT_SECRET = 'secret';
    process.env.RADIUS_HOST = 'localhost';
    process.env.RADIUS_SECRET = 'radiussecret';
    process.env.EMAIL_SUFFIX = 'example.com';
    process.env.REDIRECT_URIS = '[]'; // Empty array to allow same-origin validation
    _invalidateConfigCache(); // Force config reload
    
    // Mock successful RADIUS authentication with permitted class
    mockRadiusAuthenticate.mockResolvedValue({
      ok: true,
      class: 'admin_group', // Use a class that's in PERMITTED_CLASSES
    });
    
    // Mock cleanupExpiredCodes
    mockCleanupExpiredCodes.mockResolvedValue();
    
    // Mock storage implementation
    const mockStorage = new Map();
    const mockRefreshTokens = new Map();
    mockGetStorage.mockReturnValue({
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
    });
  });

  describe('Authorization Endpoint (RFC 6749 Section 4.1.1)', () => {
    test('should handle GET request with valid parameters', async () => {
      const url = 'http://localhost/api/oauth/authorize?response_type=code&client_id=grafana&redirect_uri=http://localhost/callback&state=abc123';
      const request = new Request(url, { method: 'GET' });
      
      const response = await authorizeGet(request);
      
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('/radius_login');
      expect(location).toContain('client_id=grafana');
      expect(location).toContain('state=abc123');
    });

    test('should reject GET request with missing required parameters', async () => {
      const url = 'http://localhost/api/oauth/authorize?client_id=grafana'; // missing response_type
      const request = new Request(url, { method: 'GET' });
      
      const response = await authorizeGet(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchOAuth2Error();
      expect(body.error).toBe('invalid_request');
    });

    test('should reject GET request with invalid client_id', async () => {
      const url = 'http://localhost/api/oauth/authorize?response_type=code&client_id=invalid&redirect_uri=http://localhost/callback';
      const request = new Request(url, { method: 'GET' });
      
      const response = await authorizeGet(request);
      
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toMatchOAuth2Error();
      expect(body.error).toBe('unauthorized_client');
    });

    test('should reject GET request with invalid response_type', async () => {
      const url = 'http://localhost/api/oauth/authorize?response_type=token&client_id=grafana&redirect_uri=http://localhost/callback';
      const request = new Request(url, { method: 'GET' });
      
      const response = await authorizeGet(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchOAuth2Error();
      expect(body.error).toBe('invalid_request');
    });
  });

  describe('Authorization Response (RFC 6749 Section 4.1.2)', () => {
    test('should generate authorization code on successful authentication', async () => {
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('state', 'abc123');
      
      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });
      
      const response = await authorizePost(request);
      
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('code=');
      expect(location).toContain('state=abc123');
      
      // Verify code format per RFC 6749
      const url = new URL(location!);
      const code = url.searchParams.get('code');
      expect(code).toBeTruthy();
      expect(code!.length).toBeGreaterThan(10); // Should be sufficiently long and unguessable
    });

    test('should preserve state parameter in authorization response', async () => {
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('state', 'custom-state-123');
      
      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });
      
      const response = await authorizePost(request);
      
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      const url = new URL(location!);
      expect(url.searchParams.get('state')).toBe('custom-state-123');
    });

    test('should handle missing state parameter correctly', async () => {
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      // No state parameter
      
      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });
      
      const response = await authorizePost(request);
      
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      const url = new URL(location!);
      expect(url.searchParams.has('state')).toBe(false);
    });
  });

  describe('Authorization Error Response (RFC 6749 Section 4.1.2.1)', () => {
    test('should return access_denied on invalid credentials', async () => {
      mockRadiusAuthenticate.mockResolvedValue({ ok: false });
      
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'wrongpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('state', 'abc123');
      
      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });
      
      const response = await authorizePost(request);
      
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('error=access_denied');
      expect(location).toContain('state=abc123');
    });

    test('should return invalid_client on client mismatch', async () => {
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'invalid');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('state', 'abc123');
      
      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });
      
      const response = await authorizePost(request);
      
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('error=invalid_client');
      expect(location).toContain('state=abc123');
    });

    test('should return server_error on RADIUS failure', async () => {
      mockRadiusAuthenticate.mockRejectedValue(new Error('RADIUS server unreachable'));
      
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('state', 'abc123');
      
      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });
      
      const response = await authorizePost(request);
      
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('error=server_error');
      expect(location).toContain('state=abc123');
    });

    test('should include error_description in error responses', async () => {
      mockRadiusAuthenticate.mockResolvedValue({ ok: false });
      
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'wrongpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('accept', 'json'); // Request JSON response for easier testing
      
      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });
      
      const response = await authorizePost(request);
      
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toMatchOAuth2Error();
      expect(body.error).toBe('access_denied');
    });
  });

  describe('Token Request (RFC 6749 Section 4.1.3)', () => {
    test('should accept valid authorization code exchange', async () => {
      // First get an authorization code
      const storage = mockGetStorage();
      const testCode = 'test-auth-code-123';
      await storage.set(testCode, {
        username: 'testuser',
        class: 'admin',
        scope: 'openid profile',
        groups: ['admin'],
        expiresAt: Date.now() + 300000, // 5 minutes
      });
      
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', testCode);
      formData.set('client_id', 'grafana');
      formData.set('client_secret', 'secret');
      
      const request = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      const response = await tokenPost(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.access_token).toBeDefined();
      expect(body.access_token).toBeValidJWT();
      expect(body.token_type).toBe('bearer');
      expect(body.expires_in).toBeGreaterThan(0);
    });

    test('should require client authentication per RFC 6749', async () => {
      const storage = mockGetStorage();
      const testCode = 'test-auth-code-123';
      await storage.set(testCode, {
        username: 'testuser',
        class: 'admin',
        scope: 'openid profile',
        groups: ['admin'],
        expiresAt: Date.now() + 300000,
      });
      
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', testCode);
      // Missing client authentication
      
      const request = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      const response = await tokenPost(request);
      
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toMatchOAuth2Error();
      expect(body.error).toBe('invalid_client');
    });

    test('should support HTTP Basic authentication for client credentials', async () => {
      const storage = mockGetStorage();
      const testCode = 'test-auth-code-123';
      await storage.set(testCode, {
        username: 'testuser',
        class: 'admin',
        scope: 'openid profile',
        groups: ['admin'],
        expiresAt: Date.now() + 300000,
      });
      
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', testCode);
      
      const credentials = Buffer.from('grafana:secret').toString('base64');
      const request = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
        },
        body: formData,
      });
      
      const response = await tokenPost(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.access_token).toBeDefined();
      expect(body.access_token).toBeValidJWT();
    });

    test('should reject expired authorization codes', async () => {
      const storage = mockGetStorage();
      const testCode = 'expired-auth-code-123';
      await storage.set(testCode, {
        username: 'testuser',
        class: 'admin',
        scope: 'openid profile',
        groups: ['admin'],
        expiresAt: Date.now() - 1000, // Expired 1 second ago
      });
      
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', testCode);
      formData.set('client_id', 'grafana');
      formData.set('client_secret', 'secret');
      
      const request = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      const response = await tokenPost(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchOAuth2Error();
      expect(body.error).toBe('invalid_grant');
    });

    test('should reject invalid authorization codes', async () => {
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', 'nonexistent-code');
      formData.set('client_id', 'grafana');
      formData.set('client_secret', 'secret');
      
      const request = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      const response = await tokenPost(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchOAuth2Error();
      expect(body.error).toBe('invalid_grant');
    });
  });

  describe('Token Response (RFC 6749 Section 4.1.4)', () => {
    test('should include all required token response fields', async () => {
      const storage = mockGetStorage();
      const testCode = 'test-auth-code-123';
      await storage.set(testCode, {
        username: 'testuser',
        class: 'admin',
        scope: 'openid profile',
        groups: ['admin'],
        expiresAt: Date.now() + 300000,
      });
      
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', testCode);
      formData.set('client_id', 'grafana');
      formData.set('client_secret', 'secret');
      
      const request = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      const response = await tokenPost(request);
      
      expect(response.status).toBe(200);
      
      // Check Content-Type
      expect(response.headers.get('content-type')).toContain('application/json');
      
      // Check Cache-Control headers per RFC 6749
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
      
      const body = await response.json();
      
      // Required fields per RFC 6749 Section 5.1
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('bearer');
      expect(body.expires_in).toBeGreaterThan(0);
      
      // Verify token format
      expect(body.access_token).toBeValidJWT();
    });

    test('should include refresh_token when applicable', async () => {
      const storage = mockGetStorage();
      const testCode = 'test-auth-code-123';
      await storage.set(testCode, {
        username: 'testuser',
        class: 'admin',
        scope: 'openid profile offline_access', // Request offline access
        groups: ['admin'],
        expiresAt: Date.now() + 300000,
      });
      
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', testCode);
      formData.set('client_id', 'grafana');
      formData.set('client_secret', 'secret');
      
      const request = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      const response = await tokenPost(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      
      expect(body.refresh_token).toBeDefined();
      expect(typeof body.refresh_token).toBe('string');
      expect(body.refresh_token.length).toBeGreaterThan(20); // Should be sufficiently long
    });

    test('should include scope in response if different from requested', async () => {
      const storage = mockGetStorage();
      const testCode = 'test-auth-code-123';
      await storage.set(testCode, {
        username: 'testuser',
        class: 'admin',
        scope: 'openid profile email', // Different from what might be expected
        groups: ['admin'],
        expiresAt: Date.now() + 300000,
      });
      
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', testCode);
      formData.set('client_id', 'grafana');
      formData.set('client_secret', 'secret');
      
      const request = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      const response = await tokenPost(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      
      // Should include scope if granted scope differs from requested
      expect(body.scope).toBeDefined();
      expect(body.scope).toBe('openid profile email');
    });
  });

  describe('Authorization Code Security (RFC 6749 Section 10.5)', () => {
    test('should generate cryptographically strong authorization codes', async () => {
      const codes = new Set<string>();
      
      for (let i = 0; i < 100; i++) {
        const formData = new FormData();
        formData.set('user', 'testuser');
        formData.set('password', 'testpass');
        formData.set('client_id', 'grafana');
        formData.set('redirect_uri', 'http://localhost/callback');
        formData.set('accept', 'json');
        
        const request = new Request('http://localhost/api/oauth/authorize', {
          method: 'POST',
          body: formData,
        });
        
        const response = await authorizePost(request);
        const body = await response.json();
        codes.add(body.code);
      }
      
      // All codes should be unique
      expect(codes.size).toBe(100);
      
      // Codes should be sufficiently long (at least 128 bits of entropy)
      const codeArray = Array.from(codes);
      codeArray.forEach(code => {
        expect(code.length).toBeGreaterThanOrEqual(16); // base64url of 12+ bytes
      });
    });

    test('should expire authorization codes after configured time', async () => {
      // This test verifies the expiration logic
      const storage = mockGetStorage();
      const testCode = 'test-auth-code-123';
      const shortExpiry = Date.now() + 100; // 100ms expiry
      
      await storage.set(testCode, {
        username: 'testuser',
        class: 'admin',
        scope: 'openid profile',
        groups: ['admin'],
        expiresAt: shortExpiry,
      });
      
      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', testCode);
      formData.set('client_id', 'grafana');
      formData.set('client_secret', 'secret');
      
      const request = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      const response = await tokenPost(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchOAuth2Error();
      expect(body.error).toBe('invalid_grant');
    });

    test('should only allow single use of authorization codes', async () => {
      const storage = mockGetStorage();
      const testCode = 'test-auth-code-123';
      await storage.set(testCode, {
        username: 'testuser',
        class: 'admin',
        scope: 'openid profile',
        groups: ['admin'],
        expiresAt: Date.now() + 300000,
      });
      
      const formData = new FormData();
      formData.set('grant_type', 'authorization_code');
      formData.set('code', testCode);
      formData.set('client_id', 'grafana');
      formData.set('client_secret', 'secret');
      
      const request1 = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      // First use should succeed
      const response1 = await tokenPost(request1);
      expect(response1.status).toBe(200);
      
      // Second use should fail
      const request2 = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: formData,
      });
      
      const response2 = await tokenPost(request2);
      expect(response2.status).toBe(400);
      const body2 = await response2.json();
      expect(body2).toMatchOAuth2Error();
      expect(body2.error).toBe('invalid_grant');
    });
  });
});
