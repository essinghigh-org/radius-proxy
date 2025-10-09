// RADIUS RFC 2865 Packet Structure Compliance Tests
// Nyaa~ Testing that our RADIUS packets are purr-fectly compliant with RFC 2865! 😺💕

import crypto from 'crypto';
import { radiusAuthenticate } from '@/lib/radius';

describe('RADIUS RFC 2865 - Packet Structure Compliance', () => {
  describe('Access-Request Packet Structure (RFC 2865 Section 4.1)', () => {
    test('should create valid Access-Request packet with correct header', async () => {
      // Mock socket to capture the sent packet
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
        // Expected to timeout, we just want to capture the packet
      }

      expect(capturedPacket).toBeDefined();
      expect(capturedPacket).toMatchRADIUSPacket();
      
      // Verify packet header fields per RFC 2865
      expect(capturedPacket[0]).toBe(1); // Code = Access-Request
      expect(capturedPacket.length).toBeGreaterThanOrEqual(20); // Minimum packet size
      
      const packetLength = capturedPacket.readUInt16BE(2);
      expect(packetLength).toBe(capturedPacket.length); // Length field accuracy
      
      // Authenticator field should be 16 bytes at offset 4
      const authenticator = capturedPacket.slice(4, 20);
      expect(authenticator.length).toBe(16);
    });

    test('should include required attributes per RFC 2865', async () => {
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
        // Expected to timeout
      }

      // Parse attributes and verify required ones are present
      const attributes = parseRADIUSAttributes(capturedPacket);
      
      // RFC 2865 Section 4.1: Access-Request SHOULD contain User-Name
      expect(attributes.has(1)).toBe(true); // User-Name (type 1)
      
      // RFC 2865 Section 4.1: Access-Request MUST contain either User-Password or CHAP-Password
      expect(attributes.has(2) || attributes.has(3)).toBe(true); // User-Password (2) or CHAP-Password (3)
      
      // RFC 2865 Section 4.1: Access-Request MUST contain either NAS-IP-Address or NAS-Identifier
      expect(attributes.has(4) || attributes.has(32)).toBe(true); // NAS-IP-Address (4) or NAS-Identifier (32)
    });

    test('should properly encode User-Name attribute per RFC 2865 Section 5.1', async () => {
      let capturedPacket: Buffer;
      const testUsername = 'test@example.com';
      
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
        await radiusAuthenticate('127.0.0.1', 'secret', testUsername, 'testpass', 100);
      } catch (e) {
        // Expected to timeout
      }

      const attributes = parseRADIUSAttributes(capturedPacket);
      const userNameAttr = attributes.get(1);
      
      expect(userNameAttr).toBeDefined();
      expect(userNameAttr!.toString('utf8')).toBe(testUsername);
    });

    test('should properly encode User-Password attribute per RFC 2865 Section 5.2', async () => {
      let capturedPacket: Buffer;
      const testPassword = 'testpassword123';
      const secret = 'sharedsecret';
      
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
        await radiusAuthenticate('127.0.0.1', secret, 'testuser', testPassword, 100);
      } catch (e) {
        // Expected to timeout
      }

      const attributes = parseRADIUSAttributes(capturedPacket);
      const passwordAttr = attributes.get(2);
      const authenticator = capturedPacket.slice(4, 20);
      
      expect(passwordAttr).toBeDefined();
      
      // Verify password is properly encrypted per RFC 2865
      // Length should be multiple of 16 bytes
      expect(passwordAttr!.length % 16).toBe(0);
      expect(passwordAttr!.length).toBeGreaterThanOrEqual(16);
      
      // Verify we can decrypt it back (sanity check)
      const decrypted = decryptUserPassword(passwordAttr!, authenticator, secret);
      expect(decrypted).toBe(testPassword);
    });
  });

  describe('Packet Size Validation (RFC 2865 Section 3)', () => {
    test('should respect minimum packet size of 20 bytes', () => {
      const minimalPacket = Buffer.alloc(20);
      minimalPacket[0] = 1; // Access-Request
      minimalPacket[1] = 123; // ID
      minimalPacket.writeUInt16BE(20, 2); // Length
      crypto.randomBytes(16).copy(minimalPacket, 4); // Authenticator
      
      expect(minimalPacket).toMatchRADIUSPacket();
    });

    test('should respect maximum packet size of 4096 bytes', () => {
      const maxPacket = Buffer.alloc(4096);
      maxPacket[0] = 1; // Access-Request
      maxPacket[1] = 123; // ID
      maxPacket.writeUInt16BE(4096, 2); // Length
      crypto.randomBytes(16).copy(maxPacket, 4); // Authenticator
      
      expect(maxPacket).toMatchRADIUSPacket();
    });

    test('should reject packets smaller than 20 bytes', () => {
      const tooSmallPacket = Buffer.alloc(19);
      expect(() => {
        expect(tooSmallPacket).toMatchRADIUSPacket();
      }).toThrow();
    });
  });

  describe('Attribute Format Validation (RFC 2865 Section 5)', () => {
    test('should validate attribute TLV format', () => {
      // Create a packet with a single attribute
      const packet = Buffer.alloc(26); // 20 header + 6 attribute
      packet[0] = 1; // Access-Request
      packet[1] = 123; // ID  
      packet.writeUInt16BE(26, 2); // Length
      crypto.randomBytes(16).copy(packet, 4); // Authenticator
      
      // Add User-Name attribute: Type=1, Length=6, Value="test"
      packet[20] = 1; // Type: User-Name
      packet[21] = 6; // Length: 2 + 4
      Buffer.from('test').copy(packet, 22);
      
      expect(packet).toMatchRADIUSPacket();
      
      const attributes = parseRADIUSAttributes(packet);
      expect(attributes.get(1)!.toString()).toBe('test');
    });

    test('should reject attributes with invalid length', () => {
      // Attribute with length field that exceeds packet boundary
      const packet = Buffer.alloc(25);
      packet[0] = 1; // Access-Request
      packet[1] = 123; // ID
      packet.writeUInt16BE(25, 2); // Length
      crypto.randomBytes(16).copy(packet, 4); // Authenticator
      
      packet[20] = 1; // Type: User-Name
      packet[21] = 10; // Length: Claims 10 bytes but only 5 available
      Buffer.from('test').copy(packet, 22);
      
      // This should be handled gracefully in parsing
      const attributes = parseRADIUSAttributes(packet);
      expect(attributes.size).toBe(0); // Should stop parsing at invalid attribute
    });
  });
});

// Helper functions for RADIUS packet testing
function parseRADIUSAttributes(packet: Buffer): Map<number, Buffer> {
  const attributes = new Map<number, Buffer>();
  let offset = 20; // Skip header
  
  while (offset + 2 <= packet.length) {
    const type = packet.readUInt8(offset);
    const length = packet.readUInt8(offset + 1);
    
    if (length < 2 || offset + length > packet.length) {
      break; // Invalid attribute
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
  
  // Remove null padding
  const nullIndex = decrypted.indexOf(0);
  return decrypted.slice(0, nullIndex === -1 ? decrypted.length : nullIndex).toString('utf8');
}
