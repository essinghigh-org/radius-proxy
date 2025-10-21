import { expect, test, describe, beforeEach, mock } from "bun:test";
import crypto from "crypto";

import { GET as authorizeGET, POST as authorizePOST } from "@/app/api/oauth/authorize/route";
import { POST as tokenPOST } from "@/app/api/oauth/token/route";
import { GET as userinfoGET } from "@/app/api/oauth/userinfo/route";
import { GET as userinfoEmailsGET } from "@/app/api/oauth/userinfo/emails/route";
import { GET as openidConfigGET } from "@/app/api/.well-known/openid-configuration/route";
import { GET as jwksGET } from "@/app/api/.well-known/jwks.json/route";

import { getStorage, closeStorage } from "@/lib/storage";
import { config, _invalidateConfigCache } from "@/lib/config";
import { signToken } from "@/lib/jwt";

// Mock radius authentication supporting both legacy and new signatures
mock.module("@/lib/radius", () => ({
  radiusAuthenticate: async (...args: unknown[]) => {
    // New signature: (username, password, timeout?)
    // Legacy signature: (host, secret, username, password, timeout?, port?)
    let username: string
    let password: string
    if (args.length >= 4 && typeof args[2] === 'string' && typeof args[3] === 'string') {
      // Legacy
      username = args[2] as string
      password = args[3] as string
    } else {
      username = args[0] as string
      password = args[1] as string
    }
    if (username === "testuser" && password === "testpass") {
      return { ok: true, class: "admin_group" }
    }
    if (username === "editor" && password === "editorpass") {
      return { ok: true, class: "editor_group" }
    }
    if (username === "forbidden" && password === "forbiddenpass") {
      return { ok: true, class: "forbidden_group" }
    }
    if (username === "emailuser" && password === "emailpass") {
      return { ok: true, class: "user_group" }
    }
    return { ok: false }
  }
}))

describe("Authentication Flow", () => {
  beforeEach(async () => {
    _invalidateConfigCache();
    await closeStorage();
  });

  describe("GET /api/oauth/authorize", () => {
    test("should redirect to login page with query parameters", async () => {
      const request = new Request(
        "http://localhost:3000/api/oauth/authorize?client_id=grafana&redirect_uri=http://localhost:3000/login/generic_oauth&response_type=code&state=123"
      );
      const response = await authorizeGET(request);

      expect(response.status).toBe(302);
      const location = response.headers.get("Location");
      expect(location).not.toBeNull();
      const redirectUrl = new URL(location!);
      expect(redirectUrl.pathname).toBe("/radius_login");
      expect(redirectUrl.searchParams.get("client_id")).toBe("grafana");
      expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3000/login/generic_oauth"
      );
      expect(redirectUrl.searchParams.get("state")).toBe("123");
    });

    test("should return 400 for invalid request", async () => {
      const request = new Request(
        "http://localhost:3000/api/oauth/authorize?client_id=grafana"
      );
      const response = await authorizeGET(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("invalid_request");
    });
  });

  describe("POST /api/oauth/authorize", () => {
    test("should return a code for valid credentials", async () => {
      const formData = new FormData();
      formData.append("user", "testuser");
      formData.append("password", "testpass");
      formData.append("client_id", "grafana");
      formData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );
      formData.append("state", "xyz");

      const request = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: formData,
        }
      );

      const response = await authorizePOST(request);
      expect(response.status).toBe(302);

      const location = response.headers.get("Location");
      expect(location).not.toBeNull();
      const redirectUrl = new URL(location!);
      const code = redirectUrl.searchParams.get("code");
      expect(code).toBeString();
      expect(redirectUrl.searchParams.get("state")).toBe("xyz");

      // Verify code in storage
      const storage = getStorage();
      const entry = await storage.get(code!);
      expect(entry).toBeDefined();
      expect(entry?.username).toBe("testuser");
    });

    test("should deny access for invalid credentials", async () => {
      const formData = new FormData();
      formData.append("user", "testuser");
      formData.append("password", "wrongpass");
      formData.append("client_id", "grafana");
      formData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );
      formData.append("state", "xyz");

      const request = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: formData,
        }
      );

      const response = await authorizePOST(request);
      expect(response.status).toBe(302);
      const location = response.headers.get("Location");
      const redirectUrl = new URL(location!);
      expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    });

    test("should deny access for user with forbidden class", async () => {
      const formData = new FormData();
      formData.append("user", "forbidden");
      formData.append("password", "forbiddenpass");
      formData.append("client_id", "grafana");
      formData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );
      formData.append("state", "xyz");

      const request = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: formData,
        }
      );

      const response = await authorizePOST(request);
      expect(response.status).toBe(302);
      const location = response.headers.get("Location");
      const redirectUrl = new URL(location!);

      // Should redirect to error page with access_denied
      expect(redirectUrl.pathname).toBe("/radius_login");
      expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
      expect(redirectUrl.searchParams.get("error_description")).toBe(
        "Class not permitted"
      );
    });

    test("should apply default scopes when none provided", async () => {
      const formData = new FormData();
      formData.append("user", "testuser");
      formData.append("password", "testpass");
      formData.append("client_id", "grafana");
      formData.append("redirect_uri", "https://grafana.example.com/login/generic_oauth");
      const request = new Request("http://localhost:54567/api/oauth/authorize", { method: "POST", body: formData });
      const response = await authorizePOST(request);
      expect(response.status).toBe(302);
      const code = new URL(response.headers.get("Location")!).searchParams.get("code");
      const storage = getStorage();
      const entry = await storage.get(code!);
      expect(entry?.scope).toBe("openid profile");
    });

    test("should accept subset of supported scopes", async () => {
      const formData = new FormData();
      formData.append("user", "testuser");
      formData.append("password", "testpass");
      formData.append("client_id", "grafana");
      formData.append("redirect_uri", "https://grafana.example.com/login/generic_oauth");
      formData.append("scope", "openid");
      const request = new Request("http://localhost:54567/api/oauth/authorize", { method: "POST", body: formData });
      const response = await authorizePOST(request);
      expect(response.status).toBe(302);
      const code = new URL(response.headers.get("Location")!).searchParams.get("code");
      const storage = getStorage();
      const entry = await storage.get(code!);
      expect(entry?.scope).toBe("openid");
    });

    test("should reject unsupported scope", async () => {
      const formData = new FormData();
      formData.append("user", "testuser");
      formData.append("password", "testpass");
      formData.append("client_id", "grafana");
      formData.append("redirect_uri", "https://grafana.example.com/login/generic_oauth");
      formData.append("scope", "openid profile imaginary");
      const request = new Request("http://localhost:54567/api/oauth/authorize", { method: "POST", body: formData });
      const response = await authorizePOST(request);
      expect(response.status).toBe(302); // redirect with error
      const loc = response.headers.get("Location");
      expect(loc).toBeString();
      const redirectUrl = new URL(loc!);
      expect(redirectUrl.searchParams.get("error")).toBe("invalid_scope");
    });

    test("should normalize duplicate and uppercase scopes", async () => {
      const formData = new FormData();
      formData.append("user", "testuser");
      formData.append("password", "testpass");
      formData.append("client_id", "grafana");
      formData.append("redirect_uri", "https://grafana.example.com/login/generic_oauth");
      formData.append("scope", "OPENID   profile openid PROFILE");
      const request = new Request("http://localhost:54567/api/oauth/authorize", { method: "POST", body: formData });
      const response = await authorizePOST(request);
      expect(response.status).toBe(302);
      const code = new URL(response.headers.get("Location")!).searchParams.get("code");
      const storage = getStorage();
      const entry = await storage.get(code!);
      // Order preserved from first occurrences: openid profile
      expect(entry?.scope).toBe("openid profile");
    });
  });

  describe("POST /api/oauth/token", () => {
    test("should return tokens for a valid code", async () => {
      // 1. Get a code first
      const authFormData = new FormData();
      authFormData.append("user", "testuser");
      authFormData.append("password", "testpass");
      authFormData.append("client_id", "grafana");
      authFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );
      authFormData.append("state", "xyz");
      const authRequest = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: authFormData,
        }
      );
      const authResponse = await authorizePOST(authRequest);
      const redirectUrl = new URL(authResponse.headers.get("Location")!);
      const code = redirectUrl.searchParams.get("code");

      // 2. Exchange code for token
      const tokenFormData = new FormData();
      tokenFormData.append("grant_type", "authorization_code");
      tokenFormData.append("code", code!);
      tokenFormData.append("client_id", "grafana");
      tokenFormData.append("client_secret", "secret");
      tokenFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );

      const tokenRequest = new Request(
        "http://localhost:54567/api/oauth/token",
        {
          method: "POST",
          body: tokenFormData,
        }
      );

      const tokenResponse = await tokenPOST(tokenRequest);
      expect(tokenResponse.status).toBe(200);
      const tokens = await tokenResponse.json();
      expect(tokens.access_token).toBeString();
      expect(tokens.id_token).toBeString();
      expect(tokens.refresh_token).toBeString();
      expect(tokens.token_type).toBe("bearer");

      // Verify code is deleted from storage
      const storage = getStorage();
      const entry = await storage.get(code!);
      expect(entry).toBeUndefined();
    });

    test("should not return tokens for an invalid code", async () => {
      const tokenFormData = new FormData();
      tokenFormData.append("grant_type", "authorization_code");
      tokenFormData.append("code", "invalidcode");
      tokenFormData.append("client_id", "grafana");
      tokenFormData.append("client_secret", "secret");

      const tokenRequest = new Request(
        "http://localhost:3000/api/oauth/token",
        {
          method: "POST",
          body: tokenFormData,
        }
      );

      const tokenResponse = await tokenPOST(tokenRequest);
      expect(tokenResponse.status).toBe(400);
      const body = await tokenResponse.json();
      expect(body.error).toBe("invalid_grant");
    });

    test("should not return tokens for an expired code", async () => {
      const storage = getStorage();
      const expiredCode = "expiredcode";
      await storage.set(expiredCode, {
        username: "testuser",
        expiresAt: Date.now() - 1000, // expired 1 second ago
      });

      const tokenFormData = new FormData();
      tokenFormData.append("grant_type", "authorization_code");
      tokenFormData.append("code", expiredCode);
      tokenFormData.append("client_id", "grafana");
      tokenFormData.append("client_secret", "secret");

      const tokenRequest = new Request(
        "http://localhost:3000/api/oauth/token",
        {
          method: "POST",
          body: tokenFormData,
        }
      );

      const tokenResponse = await tokenPOST(tokenRequest);
      expect(tokenResponse.status).toBe(400);
      const body = await tokenResponse.json();
      expect(body.error).toBe("invalid_grant");

      // Check that the expired code was deleted
      const entry = await storage.get(expiredCode);
      expect(entry).toBeUndefined();
    });

    test("should handle PKCE S256 challenge", async () => {
      const code_verifier = "some-random-verifier-string-that-is-long-enough";
      const hash = crypto
        .createHash("sha256")
        .update(code_verifier, "ascii")
        .digest();
      const code_challenge = Buffer.from(hash)
        .toString("base64")
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

      const authFormData = new FormData();
      authFormData.append("user", "testuser");
      authFormData.append("password", "testpass");
      authFormData.append("client_id", "grafana");
      authFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );
      authFormData.append("code_challenge", code_challenge);
      authFormData.append("code_challenge_method", "S256");

      const authRequest = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: authFormData,
        }
      );
      const authResponse = await authorizePOST(authRequest);
      const code = new URL(
        authResponse.headers.get("Location")!
      ).searchParams.get("code");

      const tokenFormData = new FormData();
      tokenFormData.append("grant_type", "authorization_code");
      tokenFormData.append("code", code!);
      tokenFormData.append("client_id", "grafana");
      tokenFormData.append("client_secret", "secret");
      tokenFormData.append("code_verifier", code_verifier);

      const tokenRequest = new Request(
        "http://localhost:54567/api/oauth/token",
        {
          method: "POST",
          body: tokenFormData,
        }
      );

      const tokenResponse = await tokenPOST(tokenRequest);
      expect(tokenResponse.status).toBe(200);
      const tokens = await tokenResponse.json();
      expect(tokens.access_token).toBeString();
    });

    test("should fail PKCE S256 challenge with wrong verifier", async () => {
      const code_verifier = "some-random-verifier-string-that-is-long-enough";
      const hash = crypto
        .createHash("sha256")
        .update(code_verifier, "ascii")
        .digest();
      const code_challenge = Buffer.from(hash)
        .toString("base64")
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

      const authFormData = new FormData();
      authFormData.append("user", "testuser");
      authFormData.append("password", "testpass");
      authFormData.append("client_id", "grafana");
      authFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );
      authFormData.append("code_challenge", code_challenge);
      authFormData.append("code_challenge_method", "S256");

      const authRequest = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: authFormData,
        }
      );
      const authResponse = await authorizePOST(authRequest);
      const code = new URL(
        authResponse.headers.get("Location")!
      ).searchParams.get("code");

      const tokenFormData = new FormData();
      tokenFormData.append("grant_type", "authorization_code");
      tokenFormData.append("code", code!);
      tokenFormData.append("client_id", "grafana");
      tokenFormData.append("client_secret", "secret");
      tokenFormData.append("code_verifier", "wrong-verifier");

      const tokenRequest = new Request(
        "http://localhost:54567/api/oauth/token",
        {
          method: "POST",
          body: tokenFormData,
        }
      );

      const tokenResponse = await tokenPOST(tokenRequest);
      expect(tokenResponse.status).toBe(400);
      const body = await tokenResponse.json();
      expect(body.error).toBe("invalid_grant");
    });
  });

  describe("Refresh Token Flow", () => {
    test("should be able to refresh a token", async () => {
      // 1. Get initial tokens
      const authFormData = new FormData();
      authFormData.append("user", "testuser");
      authFormData.append("password", "testpass");
      authFormData.append("client_id", "grafana");
      authFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );
      const authRequest = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: authFormData,
        }
      );
      const authResponse = await authorizePOST(authRequest);
      const code = new URL(
        authResponse.headers.get("Location")!
      ).searchParams.get("code");

      const tokenFormData = new FormData();
      tokenFormData.append("grant_type", "authorization_code");
      tokenFormData.append("code", code!);
      tokenFormData.append("client_id", "grafana");
      tokenFormData.append("client_secret", "secret");
      const tokenRequest = new Request(
        "http://localhost:54567/api/oauth/token",
        {
          method: "POST",
          body: tokenFormData,
        }
      );
      const tokenResponse = await tokenPOST(tokenRequest);
      const initialTokens = await tokenResponse.json();
      const refreshToken = initialTokens.refresh_token;

      // 2. Use refresh token to get new tokens
      const refreshFormData = new FormData();
      refreshFormData.append("grant_type", "refresh_token");
      refreshFormData.append("refresh_token", refreshToken);
      refreshFormData.append("client_id", "grafana");
      refreshFormData.append("client_secret", "secret");

      const refreshRequest = new Request(
        "http://localhost:54567/api/oauth/token",
        {
          method: "POST",
          body: refreshFormData,
        }
      );

      const refreshResponse = await tokenPOST(refreshRequest);
      expect(refreshResponse.status).toBe(200);
      const newTokens = await refreshResponse.json();
      expect(newTokens.access_token).toBeString();
      expect(newTokens.id_token).toBeString();
      expect(newTokens.refresh_token).toBeString();
      expect(newTokens.refresh_token).not.toBe(refreshToken); // check for token rotation

      // 3. Old refresh token should be invalid
      const reuseRefreshFormData = new FormData();
      reuseRefreshFormData.append("grant_type", "refresh_token");
      reuseRefreshFormData.append("refresh_token", refreshToken);
      reuseRefreshFormData.append("client_id", "grafana");
      reuseRefreshFormData.append("client_secret", "secret");
      const reuseRefreshRequest = new Request(
        "http://localhost:54567/api/oauth/token",
        {
          method: "POST",
          body: reuseRefreshFormData,
        }
      );
      const reuseRefreshResponse = await tokenPOST(reuseRefreshRequest);
      expect(reuseRefreshResponse.status).toBe(400);
    });
  });

  describe("/api/oauth/userinfo", () => {
    test("should return user info for a valid token", async () => {
      const payload = {
        sub: "testuser",
        name: "testuser",
        groups: ["admin_group"],
        role: "GrafanaAdmin",
      };
      const token = signToken(payload);

      const request = new Request("http://localhost:3000/api/oauth/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const response = await userinfoGET(request);
      expect(response.status).toBe(200);
      const userInfo = await response.json();
      expect(userInfo.sub).toBe("testuser");
      expect(userInfo.name).toBe("testuser");
      expect(userInfo.groups).toEqual(["admin_group"]);
      expect(userInfo.role).toBe("GrafanaAdmin");
    });

    test("should return 401 for an invalid token", async () => {
      const request = new Request("http://localhost:3000/api/oauth/userinfo", {
        headers: { Authorization: `Bearer invalidtoken` },
      });

      const response = await userinfoGET(request);
      expect(response.status).toBe(401);
    });
  });

  describe("/api/oauth/userinfo/emails", () => {
    test("should return user email for a valid token", async () => {
      const payload = { sub: "testuser" };
      const token = signToken(payload);

      const request = new Request(
        "http://localhost:3000/api/oauth/userinfo/emails",
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const response = await userinfoEmailsGET(request);
      expect(response.status).toBe(200);
      const emails = await response.json();
      expect(emails).toEqual([
        { email: `testuser@${config.EMAIL_SUFFIX}`, primary: true },
      ]);
    });
  });

  describe("OIDC Discovery", () => {
    test("GET /.well-known/openid-configuration", async () => {
      const request = new Request(
        "http://localhost:3000/.well-known/openid-configuration"
      );
      const response = await openidConfigGET(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.issuer).toBeDefined();
      expect(data.authorization_endpoint).toBeDefined();
      expect(data.token_endpoint).toBeDefined();
      expect(data.jwks_uri).toBeDefined();
    });

    test("GET /.well-known/jwks.json", async () => {
      const response = await jwksGET();
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.keys).toBeArray();
      // In test env, it might be HS256, so keys could be empty for JWKS (which is for asymmetric crypto)
      expect(data.keys.length).toBe(0);
    });
  });

  describe("Email Trimming Tests", () => {
    test("should extract username from email-like input and preserve email domain", async () => {
      // 1. Login with email-like username
      const authFormData = new FormData();
      authFormData.append("user", "emailuser@company.com");
      authFormData.append("password", "emailpass");
      authFormData.append("client_id", "grafana");
      authFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );
      authFormData.append("state", "xyz");

      const authRequest = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: authFormData,
        }
      );

      const authResponse = await authorizePOST(authRequest);
      expect(authResponse.status).toBe(302);
      const redirectUrl = new URL(authResponse.headers.get("Location")!);
      const code = redirectUrl.searchParams.get("code");
      expect(code).toBeString();

      // Verify the stored entry has trimmed username and preserved domain
      const storage = getStorage();
      const entry = await storage.get(code!);
      expect(entry).toBeDefined();
      expect(entry?.username).toBe("emailuser"); // Should be trimmed
      expect(entry?.emailDomain).toBe("company.com"); // Should preserve the domain

      // 2. Exchange code for tokens
      const tokenFormData = new FormData();
      tokenFormData.append("grant_type", "authorization_code");
      tokenFormData.append("code", code!);
      tokenFormData.append("client_id", "grafana");
      tokenFormData.append("client_secret", "secret");
      tokenFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );

      const tokenRequest = new Request(
        "http://localhost:54567/api/oauth/token",
        {
          method: "POST",
          body: tokenFormData,
        }
      );

      const tokenResponse = await tokenPOST(tokenRequest);
      expect(tokenResponse.status).toBe(200);
      const tokens = await tokenResponse.json();
      expect(tokens.access_token).toBeString();

      // 3. Verify userinfo has correct username (sub field)
      const userinfoRequest = new Request("http://localhost:3000/api/oauth/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      const userinfoResponse = await userinfoGET(userinfoRequest);
      expect(userinfoResponse.status).toBe(200);
      const userInfo = await userinfoResponse.json();
      expect(userInfo.sub).toBe("emailuser"); // Should be trimmed username
      expect(userInfo.name).toBe("emailuser"); // Should be trimmed username
      // Note: /userinfo doesn't include email - that's in /userinfo/emails

      // 4. Verify emails endpoint now uses the email from the token
      const emailsRequest = new Request(
        "http://localhost:3000/api/oauth/userinfo/emails",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }
      );

      const emailsResponse = await userinfoEmailsGET(emailsRequest);
      expect(emailsResponse.status).toBe(200);
      const emails = await emailsResponse.json();
      expect(emails).toEqual([
        { email: "emailuser@company.com", primary: true }, // Should now use the email from the token
      ]);
    });

    test("should handle plain username without @ symbol correctly", async () => {
      // 1. Login with plain username (no email)
      const authFormData = new FormData();
      authFormData.append("user", "testuser");
      authFormData.append("password", "testpass");
      authFormData.append("client_id", "grafana");
      authFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );
      authFormData.append("state", "xyz");

      const authRequest = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: authFormData,
        }
      );

      const authResponse = await authorizePOST(authRequest);
      expect(authResponse.status).toBe(302);
      const redirectUrl = new URL(authResponse.headers.get("Location")!);
      const code = redirectUrl.searchParams.get("code");
      expect(code).toBeString();

      // Verify the stored entry has username and default email domain
      const storage = getStorage();
      const entry = await storage.get(code!);
      expect(entry).toBeDefined();
      expect(entry?.username).toBe("testuser");
      expect(entry?.emailDomain).toBe("example.local"); // Should use config.EMAIL_SUFFIX

      // 2. Exchange code for tokens
      const tokenFormData = new FormData();
      tokenFormData.append("grant_type", "authorization_code");
      tokenFormData.append("code", code!);
      tokenFormData.append("client_id", "grafana");
      tokenFormData.append("client_secret", "secret");
      tokenFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );

      const tokenRequest = new Request(
        "http://localhost:54567/api/oauth/token",
        {
          method: "POST",
          body: tokenFormData,
        }
      );

      const tokenResponse = await tokenPOST(tokenRequest);
      expect(tokenResponse.status).toBe(200);
      const tokens = await tokenResponse.json();

      // 3. Verify userinfo has correct data
      const userinfoRequest = new Request("http://localhost:3000/api/oauth/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      const userinfoResponse = await userinfoGET(userinfoRequest);
      expect(userinfoResponse.status).toBe(200);
      const userInfo = await userinfoResponse.json();
      expect(userInfo.sub).toBe("testuser");
      expect(userInfo.name).toBe("testuser");
      // Note: /userinfo doesn't include email - that's in /userinfo/emails
    });

    test("should prevent double email suffix when user enters email-like username", async () => {
      // This test ensures username@domain.com doesn't become username@domain.com@example.local
      const authFormData = new FormData();
      authFormData.append("user", "emailuser@example.local"); // User enters email matching EMAIL_SUFFIX
      authFormData.append("password", "emailpass");
      authFormData.append("client_id", "grafana");
      authFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );

      const authRequest = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: authFormData,
        }
      );

      const authResponse = await authorizePOST(authRequest);
      expect(authResponse.status).toBe(302);
      const redirectUrl = new URL(authResponse.headers.get("Location")!);
      const code = redirectUrl.searchParams.get("code");

      // Verify storage
      const storage = getStorage();
      const entry = await storage.get(code!);
      expect(entry).toBeDefined();
      expect(entry?.username).toBe("emailuser"); // Trimmed
      expect(entry?.emailDomain).toBe("example.local"); // Extracted domain

      // Get tokens and verify email construction
      const tokenFormData = new FormData();
      tokenFormData.append("grant_type", "authorization_code");
      tokenFormData.append("code", code!);
      tokenFormData.append("client_id", "grafana");
      tokenFormData.append("client_secret", "secret");
      tokenFormData.append(
        "redirect_uri",
        "https://grafana.example.com/login/generic_oauth"
      );

      const tokenRequest = new Request(
        "http://localhost:54567/api/oauth/token",
        {
          method: "POST",
          body: tokenFormData,
        }
      );

      const tokenResponse = await tokenPOST(tokenRequest);
      const tokens = await tokenResponse.json();

      // Verify emails endpoint returns correctly constructed email (not doubled)
      const emailsRequest = new Request(
        "http://localhost:3000/api/oauth/userinfo/emails",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }
      );

      const emailsResponse = await userinfoEmailsGET(emailsRequest);
      const emails = await emailsResponse.json();
      expect(emails).toEqual([
        { email: "emailuser@example.local", primary: true }, // Should NOT be emailuser@example.local@example.local
      ]);
    });

    test("should handle edge cases with multiple @ symbols gracefully", async () => {
      // Test malformed input like user@@domain.com or user@domain@com
      const authFormData = new FormData();
      authFormData.append("user", "emailuser@@malformed.com");
      authFormData.append("password", "emailpass");
      authFormData.append("client_id", "grafana");
      authFormData.append("redirect_uri", "https://grafana.example.com/login/generic_oauth");

      const authRequest = new Request(
        "http://localhost:54567/api/oauth/authorize",
        {
          method: "POST",
          body: authFormData,
        }
      );

      const authResponse = await authorizePOST(authRequest);
      expect(authResponse.status).toBe(302);
      const redirectUrl = new URL(authResponse.headers.get("Location")!);
      const code = redirectUrl.searchParams.get("code");

      const storage = getStorage();
      const entry = await storage.get(code!);
      expect(entry).toBeDefined();
      expect(entry?.username).toBe("emailuser"); // Should take first part before @
      expect(entry?.emailDomain).toBe("@malformed.com"); // Everything after the first '@' is considered the domain
    });
  });
});