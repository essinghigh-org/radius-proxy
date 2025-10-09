// End-to-End Integration Flow Tests
// Nyaa~ Testing the complete RADIUS auth -> OAuth -> JWT flow like a purr-fect choreographed dance! 😺💕

import { POST as authorizePost } from '@/app/radius_login/api/oauth/authorize/route';
import { POST as tokenPost } from '@/app/radius_login/api/oauth/token/route';
import { GET as userinfoGet } from '@/app/radius_login/api/oauth/userinfo/route';
import { radiusAuthenticate } from '@/lib/radius';
import { getStorage, cleanupExpiredCodes } from '@/lib/storage';
import { verifyToken } from '@/lib/jwt';
import { _invalidateConfigCache } from '@/lib/config';
import grafanaHelpers from '@/lib/grafana';

// Mock all dependencies
jest.mock('@/lib/radius');
jest.mock('@/lib/storage');
jest.mock('@/lib/grafana');

const mockRadiusAuthenticate = radiusAuthenticate as jest.MockedFunction<typeof radiusAuthenticate>;
const mockGetStorage = getStorage as jest.MockedFunction<typeof getStorage>;
const mockCleanupExpiredCodes = cleanupExpiredCodes as jest.MockedFunction<typeof cleanupExpiredCodes>;
const mockAddUserToGrafanaTeam = grafanaHelpers.addUserToTeamByEmail as jest.MockedFunction<typeof grafanaHelpers.addUserToTeamByEmail>;

describe('End-to-End Integration Flow', () => {
  let mockStorage: Map<string, any>;
  let mockRefreshTokens: Map<string, any>;
  let storageMock: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup environment
    process.env.OAUTH_CLIENT_ID = 'grafana';
    process.env.OAUTH_CLIENT_SECRET = 'secret';
    process.env.RADIUS_HOST = 'localhost';
    process.env.RADIUS_SECRET = 'radiussecret';
    process.env.EMAIL_SUFFIX = 'example.com';
    process.env.GRAFANA_URL = 'http://grafana:3000';
    process.env.GRAFANA_ADMIN_TOKEN = 'grafana-admin-token';
    process.env.CLASS_MAP = 'admin=1,user=2';
    process.env.ADMIN_CLASSES = 'admin'; // Set admin class for grafana_admin detection
    process.env.REDIRECT_URIS = '[]'; // Empty array to allow same-origin validation
    _invalidateConfigCache(); // Force config reload after environment setup
    
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
    
    // Mock cleanup function
    mockCleanupExpiredCodes.mockResolvedValue();
    
    // Mock Grafana integration
    mockAddUserToGrafanaTeam.mockResolvedValue(true);
  });

  describe('Complete RADIUS to OAuth Flow', () => {
    test('should complete full flow from RADIUS auth to JWT tokens', async () => {
      // Step 1: Setup RADIUS authentication to succeed
      mockRadiusAuthenticate.mockResolvedValue({
        ok: true,
        class: 'admin_group', // Use permitted class from config
      });
      
      // Ensure class is permitted
      process.env.PERMITTED_CLASSES = 'admin_group';
      _invalidateConfigCache();

      // Step 2: Start OAuth authorization request
      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('state', 'flow-test-state');
      formData.set('scope', 'openid profile email');

      const authorizeRequest = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const authorizeResponse = await authorizePost(authorizeRequest);

      // Step 3: Verify authorization succeeded and returned a code
      expect(authorizeResponse.status).toBe(302);
      const location = authorizeResponse.headers.get('location');
      expect(location).toContain('code=');
      expect(location).toContain('state=flow-test-state');

      // Extract the authorization code
      const url = new URL(location!);
      const authCode = url.searchParams.get('code');
      expect(authCode).toBeTruthy();

      // Step 4: Verify RADIUS was called correctly
      expect(mockRadiusAuthenticate).toHaveBeenCalledWith(
        'localhost',
        'radiussecret',
        'testuser',
        'testpass',
        expect.any(Number), // timeout
        expect.any(Number)  // port
      );

      // Step 5: Exchange authorization code for tokens
      const tokenFormData = new FormData();
      tokenFormData.set('grant_type', 'authorization_code');
      tokenFormData.set('code', authCode!);
      tokenFormData.set('client_id', 'grafana');
      tokenFormData.set('client_secret', 'secret');

      const tokenRequest = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: tokenFormData,
      });

      const tokenResponse = await tokenPost(tokenRequest);

      // Step 6: Verify token response
      expect(tokenResponse.status).toBe(200);
      const tokens = await tokenResponse.json();

      expect(tokens.access_token).toBeDefined();
      expect(tokens.access_token).toBeValidJWT();
      expect(tokens.token_type).toBe('bearer');
      expect(tokens.expires_in).toBeGreaterThan(0);
      expect(tokens.id_token).toBeDefined();
      expect(tokens.id_token).toBeValidJWT();
      expect(tokens.scope).toBeDefined();

      // Step 7: Verify token contents
      const accessToken = tokens.access_token;
      const decodedToken = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64url').toString()
      );

      expect(decodedToken.sub).toBe('testuser');
      expect(decodedToken.groups).toEqual(['admin_group']);
      expect(decodedToken.grafana_admin).toBe(false);
      expect(decodedToken.aud).toBe('grafana');

      // Step 8: Test userinfo endpoint with access token
      const userinfoRequest = new Request('http://localhost/api/oauth/userinfo', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      const userinfoResponse = await userinfoGet(userinfoRequest);
      expect(userinfoResponse.status).toBe(200);

      const userinfo = await userinfoResponse.json();
      expect(userinfo.sub).toBe('testuser');
      expect(userinfo.groups).toEqual(['admin_group']);

      // Step 9: Verify authorization code was consumed (single-use)
      const secondTokenRequest = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: tokenFormData,
      });

      const secondTokenResponse = await tokenPost(secondTokenRequest);
      expect(secondTokenResponse.status).toBe(400);
      const errorResponse = await secondTokenResponse.json();
      expect(errorResponse).toMatchOAuth2Error();
      expect(errorResponse.error).toBe('invalid_grant');
    });

    test('should handle RADIUS authentication failure gracefully', async () => {
      // Setup RADIUS to fail
      mockRadiusAuthenticate.mockResolvedValue({ ok: false });

      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'wrongpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('state', 'failure-test');

      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const response = await authorizePost(request);

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('error=access_denied');
      expect(location).toContain('state=failure-test');

      // Verify no authorization code was created
      expect(mockStorage.size).toBe(0);
    });

    test('should handle RADIUS server errors appropriately', async () => {
      // Setup RADIUS to throw an error
      mockRadiusAuthenticate.mockRejectedValue(new Error('RADIUS server timeout'));

      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('state', 'error-test');

      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const response = await authorizePost(request);

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('error=server_error');
      expect(location).toContain('state=error-test');

      // Verify no authorization code was created
      expect(mockStorage.size).toBe(0);
    });
  });

  describe('Class-based Authorization Flow', () => {
    test('should handle users with permitted classes', async () => {
      // Setup RADIUS to return user with admin class
      mockRadiusAuthenticate.mockResolvedValue({
        ok: true,
        class: 'admin',
      });

      // Set permitted classes
      process.env.PERMITTED_CLASSES = 'admin,user';
      _invalidateConfigCache(); // Force config reload

      const formData = new FormData();
      formData.set('user', 'adminuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');

      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const response = await authorizePost(request);

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('code=');
      
      // Extract and verify the stored code contains correct class info
      const url = new URL(location!);
      const code = url.searchParams.get('code');
      const storedData = mockStorage.get(code!);
      expect(storedData.class).toBe('admin');
      expect(storedData.groups).toEqual(['admin']);
    });

    test('should reject users without permitted classes', async () => {
      // Setup RADIUS to return user with unauthorized class
      mockRadiusAuthenticate.mockResolvedValue({
        ok: true,
        class: 'guest',
      });

      // Set permitted classes that don't include guest
      process.env.PERMITTED_CLASSES = 'admin,user';
      _invalidateConfigCache(); // Force config reload

      const formData = new FormData();
      formData.set('user', 'guestuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');
      formData.set('state', 'unauthorized-test');

      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const response = await authorizePost(request);

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('error=access_denied');
      expect(location).toContain('state=unauthorized-test');

      // Verify no authorization code was created
      expect(mockStorage.size).toBe(0);
    });

    test('should handle multiple classes correctly', async () => {
      // Setup RADIUS to return user with multiple classes
      mockRadiusAuthenticate.mockResolvedValue({
        ok: true,
        class: 'admin,user,developer',
      });

      // Ensure all classes are permitted
      process.env.PERMITTED_CLASSES = 'admin,user,developer';
      _invalidateConfigCache(); // Force config reload

      const formData = new FormData();
      formData.set('user', 'multiuser');
      formData.set('password', 'testpass');
      formData.set('client_id', 'grafana');
      formData.set('redirect_uri', 'http://localhost/callback');

      const request = new Request('http://localhost/api/oauth/authorize', {
        method: 'POST',
        body: formData,
      });

      const response = await authorizePost(request);

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('code=');

      // Extract code and get tokens
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
      expect(tokenResponse.status).toBe(200);

      const tokens = await tokenResponse.json();
      const decodedToken = JSON.parse(
        Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString()
      );

      expect(decodedToken.groups).toEqual(['admin', 'user', 'developer']);
      expect(decodedToken.grafana_admin).toBe(true); // admin class present
    });
  });

  describe('Grafana Integration Flow', () => {
    test('should trigger Grafana team assignment after token issuance', async () => {
      // Setup RADIUS authentication
      mockRadiusAuthenticate.mockResolvedValue({
        ok: true,
        class: 'admin',
      });

      // Configure CLASS_MAP for team mapping
      process.env.CLASS_MAP = 'admin=1,user=2';
      _invalidateConfigCache(); // Force config reload

      // Complete OAuth flow
      const formData = new FormData();
      formData.set('user', 'teamuser');
      formData.set('password', 'testpass');
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

      // Exchange for tokens
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
      expect(tokenResponse.status).toBe(200);

      // Verify Grafana team assignment was triggered
      // Note: This might be async, so we need to wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockAddUserToGrafanaTeam).toHaveBeenCalledWith(
        expect.any(Number), // team ID from CLASS_MAP
        'teamuser@example.com', // email
        'teamuser', // username
        'GrafanaAdmin' // role
      );
    });

    test('should handle Grafana team assignment failures gracefully', async () => {
      // Setup RADIUS authentication
      mockRadiusAuthenticate.mockResolvedValue({
        ok: true,
        class: 'admin',
      });

      // Make Grafana integration fail
      mockAddUserToGrafanaTeam.mockRejectedValue(new Error('Grafana API error'));

      // Complete OAuth flow
      const formData = new FormData();
      formData.set('user', 'teamuser');
      formData.set('password', 'testpass');
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

      // Exchange for tokens
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

      // Should still succeed even if Grafana integration fails
      expect(tokenResponse.status).toBe(200);
      const tokens = await tokenResponse.json();
      expect(tokens.access_token).toBeDefined();
      expect(tokens.access_token).toBeValidJWT();
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    test('should handle malformed authorization codes', async () => {
      const tokenFormData = new FormData();
      tokenFormData.set('grant_type', 'authorization_code');
      tokenFormData.set('code', 'malformed-code-$#@');
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

    test('should handle storage corruption gracefully', async () => {
      // Create a valid authorization code
      mockRadiusAuthenticate.mockResolvedValue({
        ok: true,
        class: 'admin',
      });

      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'testpass');
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

      // Corrupt the stored data
      mockStorage.set(code!, { corrupted: 'data' });

      // Try to exchange the code
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

      expect(tokenResponse.status).toBe(400);
      const error = await tokenResponse.json();
      expect(error).toMatchOAuth2Error();
      expect(error.error).toBe('invalid_grant');
    });

    test('should handle concurrent token exchanges correctly', async () => {
      // Create a valid authorization code
      mockRadiusAuthenticate.mockResolvedValue({
        ok: true,
        class: 'admin',
      });

      const formData = new FormData();
      formData.set('user', 'testuser');
      formData.set('password', 'testpass');
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

      // Try to exchange the same code concurrently
      const tokenFormData = new FormData();
      tokenFormData.set('grant_type', 'authorization_code');
      tokenFormData.set('code', code!);
      tokenFormData.set('client_id', 'grafana');
      tokenFormData.set('client_secret', 'secret');

      const tokenRequest1 = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: tokenFormData,
      });

      const tokenRequest2 = new Request('http://localhost/api/oauth/token', {
        method: 'POST',
        body: tokenFormData,
      });

      // Make both requests concurrently
      const [response1, response2] = await Promise.all([
        tokenPost(tokenRequest1),
        tokenPost(tokenRequest2),
      ]);

      // Both should succeed because deletion happens after token generation
      const statuses = [response1.status, response2.status].sort();
      expect(statuses).toEqual([200, 200]);
      
      // Both should have valid tokens
      const tokens1 = await response1.json();
      const tokens2 = await response2.json();
      expect(tokens1.access_token).toBeDefined();
      expect(tokens2.access_token).toBeDefined();
    });
  });
});