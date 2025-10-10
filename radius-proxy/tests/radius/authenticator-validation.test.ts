// RADIUS RFC 2865 Authenticator Validation Tests  

import crypto from 'crypto';
import dgram from 'dgram';
import { radiusAuthenticate } from '@/lib/radius';
import { config } from '@/lib/config';

describe('RADIUS RFC 2865 - Authenticator Validation', () => {
  describe('Request Authenticator (RFC 2865 Section 3)', () => {
    test('should generate unpredictable Request Authenticator', async () => {
      const capturedPackets: Buffer[] = [];
      
      const mockSocket = {
        createSocket: jest.fn(() => ({
          send: jest.fn((packet: Buffer, port: number, host: string, cb: Function) => {
            capturedPackets.push(Buffer.from(packet));
            cb(null);
          }),
          on: jest.fn(),
          close: jest.fn(),
        })),
      };
      
      const dgram = require('dgram');
      dgram.createSocket = mockSocket.createSocket;

      // Generate multiple packets to test uniqueness
      for (let i = 0; i < 5; i++) {
        try {
          await radiusAuthenticate('127.0.0.1', 'secret', 'testuser', 'testpass', 100);
        } catch (e) {
          // Expected timeout
        }
      }

      expect(capturedPackets.length).toBe(5);
      
      // Extract authenticators and verify they're unique
      const authenticators = capturedPackets.map(packet => packet.slice(4, 20));
      const uniqueAuthenticators = new Set(authenticators.map(auth => auth.toString('hex')));
      
      expect(uniqueAuthenticators.size).toBe(5); // All should be unique
      
      // Each authenticator should be exactly 16 bytes
      authenticators.forEach(auth => {
        expect(auth.length).toBe(16);
      });
    });

    test('should use Request Authenticator in password encryption', async () => {
      let capturedPacket: Buffer;
      const secret = 'testsecret';
      const password = 'testpassword';
      
      const mockSocket = {
        createSocket: jest.fn(() => ({
          send: jest.fn((packet: Buffer, port: number, host: string, cb: Function) => {
            capturedPacket = packet;
            cb(null);
          }),
          on: jest.fn(),
          close: jest.fn(),
        })),
      };
      
      const dgram = require('dgram');
      dgram.createSocket = mockSocket.createSocket;

      try {
        await radiusAuthenticate('127.0.0.1', secret, 'testuser', password, 100);
      } catch (e) {
        // Expected timeout
      }

      const requestAuth = capturedPacket.slice(4, 20);
      const attributes = parseRADIUSAttributes(capturedPacket);
      const encryptedPassword = attributes.get(2)!;
      
      // Verify password encryption uses the Request Authenticator
      const decrypted = decryptUserPassword(encryptedPassword, requestAuth, secret);
      expect(decrypted).toBe(password);
    });
  });

  describe('Response Authenticator Verification (RFC 2865 Section 3)', () => {
    test('should verify valid Response Authenticator', async () => {
      const mockClient = createMockRADIUSClient();
      
      // Set up a fake server that sends proper Access-Accept
      const secret = 'testsecret';
      const username = 'testuser';
      const password = 'testpass';
      
      let requestPacket: Buffer;
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        requestPacket = packet;
        cb(null);
        
        // Simulate proper Access-Accept response
        setTimeout(() => {
          const response = createAccessAcceptResponse(packet, secret, 'testclass');
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, username, password, 5000);
      
      expect(result.ok).toBe(true);
      expect(result.class).toBe('testclass');
    });

    test('should reject response with invalid Response Authenticator', async () => {
      const mockClient = createMockRADIUSClient();
      
      const secret = 'testsecret';
      
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        cb(null);
        
        // Send response with invalid authenticator
        setTimeout(() => {
          const response = createAccessAcceptResponse(packet, secret, 'testclass');
          // Corrupt the Response Authenticator
          response[5] = response[5] ^ 0xFF;
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
      
      // Should reject due to authenticator mismatch
      expect(result.ok).toBe(false);
    });

    test('should compute Response Authenticator correctly per RFC 2865', () => {
      // Test the Response Authenticator calculation formula:
      // ResponseAuth = MD5(Code + ID + Length + RequestAuth + Attributes + Secret)
      
      const code = Buffer.from([2]); // Access-Accept
      const id = Buffer.from([123]);
      const requestAuth = crypto.randomBytes(16);
      const attributes = Buffer.from([config.RADIUS_ASSIGNMENT, 5, 116, 101, 115, 116]); // Class="test" (or configured attribute) 
      const secret = 'testsecret';
      const length = Buffer.alloc(2);
      length.writeUInt16BE(20 + attributes.length, 0);
      
      const expected = crypto.createHash('md5')
        .update(Buffer.concat([code, id, length, requestAuth, attributes, Buffer.from(secret, 'utf8')]))
        .digest();
      
      // Create response packet
      const response = Buffer.alloc(20 + attributes.length);
      response[0] = 2; // Access-Accept
      response[1] = 123; // ID
      response.writeUInt16BE(20 + attributes.length, 2);
      expected.copy(response, 4); // Response Authenticator
      attributes.copy(response, 20);
      
      // Verify our calculation matches
      const computed = computeResponseAuthenticator(response, requestAuth, secret);
      expect(computed.equals(expected)).toBe(true);
    });
  });

  describe('Message-Authenticator Support (RFC 2869)', () => {
    test('should include Message-Authenticator attribute when present', async () => {
      let capturedPacket: Buffer;
      
      const mockSocket = {
        createSocket: jest.fn(() => ({
          send: jest.fn((packet: Buffer, port: number, host: string, cb: Function) => {
            capturedPacket = packet;
            cb(null);
          }),
          on: jest.fn(),
          close: jest.fn(),
        })),
      };
      
      const dgram = require('dgram');
      dgram.createSocket = mockSocket.createSocket;

      try {
        await radiusAuthenticate('127.0.0.1', 'secret', 'testuser', 'testpass', 100);
      } catch (e) {
        // Expected timeout
      }

      const attributes = parseRADIUSAttributes(capturedPacket);
      
      // Should include Message-Authenticator (type 80)
      expect(attributes.has(80)).toBe(true);
      
      const messageAuth = attributes.get(80)!;
      expect(messageAuth.length).toBe(16); // Must be exactly 16 bytes
    });

    test('should compute Message-Authenticator correctly per RFC 2869', async () => {
      let capturedPacket: Buffer;
      const secret = 'testsecret';
      
      const mockSocket = {
        createSocket: jest.fn(() => ({
          send: jest.fn((packet: Buffer, port: number, host: string, cb: Function) => {
            capturedPacket = packet;
            cb(null);
          }),
          on: jest.fn(),
          close: jest.fn(),
        })),
      };
      
      const dgram = require('dgram');
      dgram.createSocket = mockSocket.createSocket;

      try {
        await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 100);
      } catch (e) {
        // Expected timeout
      }

      // Verify Message-Authenticator is computed correctly
      // It should be HMAC-MD5 of the entire packet with Message-Authenticator zeroed
      const packet = Buffer.from(capturedPacket);
      
      // Find Message-Authenticator attribute and zero it
      let offset = 20;
      while (offset + 2 <= packet.length) {
        const type = packet.readUInt8(offset);
        const length = packet.readUInt8(offset + 1);
        
        if (type === 80 && length === 18) {
          // Zero out the Message-Authenticator value
          packet.fill(0, offset + 2, offset + 18);
          break;
        }
        
        offset += length;
      }
      
      // Compute expected HMAC-MD5
      const expected = crypto.createHmac('md5', Buffer.from(secret, 'utf8')).update(packet).digest();
      
      // Get actual Message-Authenticator from original packet
      const attributes = parseRADIUSAttributes(capturedPacket);
      const actual = attributes.get(80)!;
      
      expect(actual.equals(expected)).toBe(true);
    });
  });
});

// Helper functions for authenticator testing
function createMockRADIUSClient() {
  let messageHandler: (msg: Buffer) => void;
  
  const mockSocket = {
    send: jest.fn(),
    on: jest.fn((event: string, handler: Function) => {
      if (event === 'message') {
        messageHandler = handler as (msg: Buffer) => void;
      }
    }),
    close: jest.fn(),
  };
  
  const dgram = require('dgram');
  dgram.createSocket = jest.fn(() => mockSocket);
  
  return {
    mockSocket,
    messageHandler: (msg: Buffer) => messageHandler(msg),
  };
}

function createAccessAcceptWithClassAuth(requestPacket: Buffer, secret: string, classValue: string | null, attributeType: number = 25): Buffer {
  const requestAuth = requestPacket.slice(4, 20);
  const id = requestPacket[1];
  
  const attributes: Buffer[] = [];
  if (classValue !== null) {
    const classBuf = Buffer.from(classValue, 'utf8');
    attributes.push(Buffer.concat([Buffer.from([attributeType, classBuf.length + 2]), classBuf]));
  }
  
  const attrBuf = attributes.length ? Buffer.concat(attributes) : Buffer.alloc(0);
  const responseLength = 20 + attrBuf.length;
  
  // Build response with placeholder authenticator
  const response = Buffer.alloc(responseLength);
  response[0] = 2; // Access-Accept
  response[1] = id;
  response.writeUInt16BE(responseLength, 2);
  attrBuf.copy(response, 20);
  
  // Compute Response Authenticator
  const responseAuth = computeResponseAuthenticator(response, requestAuth, secret);
  responseAuth.copy(response, 4);
  
  return response;
}

function computeResponseAuthenticator(responsePacket: Buffer, requestAuth: Buffer, secret: string): Buffer {
  const code = Buffer.from([responsePacket[0]]);
  const id = Buffer.from([responsePacket[1]]);
  const length = responsePacket.slice(2, 4);
  const attributes = responsePacket.slice(20);
  
  return crypto.createHash('md5')
    .update(Buffer.concat([code, id, length, requestAuth, attributes, Buffer.from(secret, 'utf8')]))
    .digest();
}

function parseRADIUSAttributes(packet: Buffer): Map<number, Buffer> {
  const attributes = new Map<number, Buffer>();
  let offset = 20;
  
  while (offset + 2 <= packet.length) {
    const type = packet.readUInt8(offset);
    const length = packet.readUInt8(offset + 1);
    
    if (length < 2 || offset + length > packet.length) {
      break;
    }
    
    const value = packet.slice(offset + 2, offset + length);
    attributes.set(type, value);
    offset += length;
  }
  
  return attributes;
}

function decryptUserPassword(encrypted: Buffer, authenticator: Buffer, secret: string): string {
  const secretBuf = Buffer.from(secret, 'utf8');
  const decrypted = Buffer.alloc(encrypted.length);
  
  let prev = authenticator;
  for (let b = 0; b < encrypted.length / 16; b++) {
    const md5 = crypto.createHash('md5').update(Buffer.concat([secretBuf, prev])).digest();
    for (let i = 0; i < 16; i++) {
      decrypted[b * 16 + i] = encrypted[b * 16 + i] ^ md5[i];
    }
    prev = encrypted.slice(b * 16, b * 16 + 16);
  }
  
  const nullIndex = decrypted.indexOf(0);
  return decrypted.slice(0, nullIndex === -1 ? decrypted.length : nullIndex).toString('utf8');
}

function createAccessAcceptResponse(requestPacket: Buffer, secret: string, classValue: string | null): Buffer {
  const requestAuth = requestPacket.slice(4, 20);
  const id = requestPacket[1];
  
  const attributes: Buffer[] = [];
  if (classValue !== null) {
    const classBuf = Buffer.from(classValue, 'utf8');
    attributes.push(Buffer.concat([Buffer.from([config.RADIUS_ASSIGNMENT, classBuf.length + 2]), classBuf]));
  }
  
  return buildAccessAcceptResponse(id, requestAuth, secret, attributes);
}

function buildAccessAcceptResponse(id: number, requestAuth: Buffer, secret: string, attributes: Buffer[]): Buffer {
  const attrBuf = attributes.length ? Buffer.concat(attributes) : Buffer.alloc(0);
  const responseLength = 20 + attrBuf.length;
  
  const response = Buffer.alloc(responseLength);
  response[0] = 2; // Access-Accept
  response[1] = id;
  response.writeUInt16BE(responseLength, 2);
  attrBuf.copy(response, 20);
  
  // Compute Response Authenticator per RFC 2865
  const code = Buffer.from([2]);
  const idBuf = Buffer.from([id]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(responseLength, 0);
  
  const responseAuth = crypto.createHash('md5')
    .update(Buffer.concat([code, idBuf, length, requestAuth, attrBuf, Buffer.from(secret, 'utf8')]))
    .digest();
  
  responseAuth.copy(response, 4);
  return response;
}
