// Jest setup file for radius-proxy tests 

import * as crypto from 'crypto';

// Set up test environment variables  
Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: false });
process.env.LOG_LEVEL = 'error';

// Mock crypto for deterministic tests
Object.defineProperty(global, 'crypto', {
  value: {
    getRandomValues: jest.fn().mockImplementation((arr: Uint8Array) => {
      // Deterministic "random" values for testing
      for (let i = 0; i < arr.length; i++) {
        arr[i] = i % 256;
      }
      return arr;
    }),
    randomBytes: jest.fn().mockImplementation((size: number) => {
      const buffer = Buffer.alloc(size);
      for (let i = 0; i < size; i++) {
        buffer[i] = i % 256;
      }
      return buffer;
    }),
    subtle: {
      digest: jest.fn(),
    },
  },
});

// Set up test environment variables
Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: false });
process.env.LOG_LEVEL = 'error';

// Global test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidJWT(): R;
      toMatchRADIUSPacket(): R;
      toMatchOAuth2Error(): R;
    }
  }
}

// Custom Jest matchers for protocol compliance
expect.extend({
  toBeValidJWT(received: string) {
    try {
      const parts = received.split('.');
      if (parts.length !== 3) {
        return {
          message: () => `Expected valid JWT with 3 parts, got ${parts.length}`,
          pass: false,
        };
      }
      
      // Try to decode header and payload
      JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      
      return {
        message: () => `Expected invalid JWT, but got valid one`,
        pass: true,
      };
    } catch (error) {
      return {
        message: () => `Expected valid JWT, got error: ${error}`,
        pass: false,
      };
    }
  },

  toMatchRADIUSPacket(received: Buffer) {
    if (!Buffer.isBuffer(received)) {
      return {
        message: () => `Expected Buffer, got ${typeof received}`,
        pass: false,
      };
    }

    if (received.length < 20) {
      return {
        message: () => `RADIUS packet too short: ${received.length} bytes (minimum 20)`,
        pass: false,
      };
    }

    const code = received[0];
    const length = received.readUInt16BE(2);

    if (length !== received.length) {
      return {
        message: () => `Length mismatch: header says ${length}, actual ${received.length}`,
        pass: false,
      };
    }

    if (![1, 2, 3, 11].includes(code)) {
      return {
        message: () => `Invalid RADIUS code: ${code}`,
        pass: false,
      };
    }

    return {
      message: () => `Expected invalid RADIUS packet, but got valid one`,
      pass: true,
    };
  },

  toMatchOAuth2Error(received: any) {
    const validErrors = [
      'invalid_request',
      'invalid_client', 
      'invalid_grant',
      'unauthorized_client',
      'unsupported_grant_type',
      'invalid_scope',
      'access_denied',
      'unsupported_response_type',
      'server_error',
      'temporarily_unavailable'
    ];

    if (typeof received !== 'object' || !received.error) {
      return {
        message: () => `Expected OAuth2 error object with 'error' property`,
        pass: false,
      };
    }

    if (!validErrors.includes(received.error)) {
      return {
        message: () => `Invalid OAuth2 error code: ${received.error}`,
        pass: false,
      };
    }

    return {
      message: () => `Expected invalid OAuth2 error, but got valid one`,
      pass: true,
    };
  },
});

// Console spy to reduce noise in tests
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});
