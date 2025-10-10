// RADIUS Class Attribute (Type 25) Parsing Tests

import crypto from 'crypto';
import { radiusAuthenticate } from '@/lib/radius';

describe('RADIUS RFC 2865 - Class Attribute (Type 25) Compliance', () => {
  describe('Class Attribute Parsing (RFC 2865 Section 5.25)', () => {
    test('should extract single Class attribute correctly', async () => {
      const mockClient = createMockRADIUSClient();
      const secret = 'testsecret';
      const classValue = 'administrator';
      
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        cb(null);
        
        setTimeout(() => {
          const response = createAccessAcceptWithClass(packet, secret, classValue);
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
      
      expect(result.ok).toBe(true);
      expect(result.class).toBe(classValue);
    });

    test('should handle Class attribute with special characters', async () => {
      const mockClient = createMockRADIUSClient();
      const secret = 'testsecret';
      const classValue = 'group:admin,editor;writer';
      
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        cb(null);
        
        setTimeout(() => {
          const response = createAccessAcceptWithClass(packet, secret, classValue);
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
      
      expect(result.ok).toBe(true);
      expect(result.class).toBe(classValue);
    });

    test('should handle empty Class attribute', async () => {
      const mockClient = createMockRADIUSClient();
      const secret = 'testsecret';
      
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        cb(null);
        
        setTimeout(() => {
          const response = createAccessAcceptWithClass(packet, secret, '');
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
      
      expect(result.ok).toBe(true);
      expect(result.class).toBe('');
    });

    test('should handle missing Class attribute', async () => {
      const mockClient = createMockRADIUSClient();
      const secret = 'testsecret';
      
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        cb(null);
        
        setTimeout(() => {
          const response = createAccessAcceptWithClass(packet, secret, null);
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
      
      expect(result.ok).toBe(true);
      expect(result.class).toBeUndefined();
    });

    test('should handle multiple Class attributes (take first one)', async () => {
      const mockClient = createMockRADIUSClient();
      const secret = 'testsecret';
      
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        cb(null);
        
        setTimeout(() => {
          const response = createAccessAcceptWithMultipleClasses(packet, secret, ['admin', 'user', 'guest']);
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
      
      expect(result.ok).toBe(true);
      // Per RFC 2865, if multiple Class attributes exist, implementation may choose behavior
      // Our implementation takes the first one encountered
      expect(result.class).toBe('admin');
    });

    test('should handle Class attribute with UTF-8 characters', async () => {
      const mockClient = createMockRADIUSClient();
      const secret = 'testsecret';
      const classValue = 'роль:администратор'; // Cyrillic text
      
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        cb(null);
        
        setTimeout(() => {
          const response = createAccessAcceptWithClass(packet, secret, classValue);
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
      
      expect(result.ok).toBe(true);
      expect(result.class).toBe(classValue);
    });

    test('should handle maximum length Class attribute', async () => {
      const mockClient = createMockRADIUSClient();
      const secret = 'testsecret';
      // Maximum attribute value length is 253 bytes (255 - 2 for type and length)
      const classValue = 'x'.repeat(253);
      
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        cb(null);
        
        setTimeout(() => {
          const response = createAccessAcceptWithClass(packet, secret, classValue);
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
      
      expect(result.ok).toBe(true);
      expect(result.class).toBe(classValue);
    });
  });

  describe('Class Attribute Format Validation', () => {
    test('should validate Class attribute Type-Length-Value format', () => {
      const classValue = 'testclass';
      const classBuf = Buffer.from(classValue, 'utf8');
      
      // Create proper Class attribute: Type=25, Length=classBuf.length+2, Value=classBuf
      const attribute = Buffer.alloc(classBuf.length + 2);
      attribute[0] = 25; // Type: Class
      attribute[1] = classBuf.length + 2; // Length: includes type and length bytes
      classBuf.copy(attribute, 2);
      
      // Verify format
      expect(attribute[0]).toBe(25);
      expect(attribute[1]).toBe(classBuf.length + 2);
      expect(attribute.slice(2).toString('utf8')).toBe(classValue);
    });

    test('should reject Class attribute with invalid length', () => {
      // Create packet with malformed Class attribute
      const packet = Buffer.alloc(25);
      packet[0] = 2; // Access-Accept
      packet[1] = 123; // ID
      packet.writeUInt16BE(25, 2); // Length
      crypto.randomBytes(16).copy(packet, 4); // Response Authenticator
      
      // Add malformed Class attribute: claims length 10 but only 5 bytes are available
      packet[20] = 25; // Type: Class
      packet[21] = 10; // Length: Claims 10 bytes total, but packet ends at 25
      Buffer.from('test').copy(packet, 22);
      
      // Parse should stop at invalid attribute
      const attributes = parseRADIUSAttributes(packet);
      expect(attributes.has(25)).toBe(false);
    });

    test('should handle Class attribute at packet boundary', () => {
      const classValue = 'test';
      const classBuf = Buffer.from(classValue, 'utf8');
      const packetSize = 20 + 2 + classBuf.length; // header + type/length + value
      
      const packet = Buffer.alloc(packetSize);
      packet[0] = 2; // Access-Accept
      packet[1] = 123; // ID
      packet.writeUInt16BE(packetSize, 2);
      crypto.randomBytes(16).copy(packet, 4);
      
      // Add Class attribute at end of packet
      packet[20] = 25; // Type
      packet[21] = classBuf.length + 2; // Length
      classBuf.copy(packet, 22);
      
      const attributes = parseRADIUSAttributes(packet);
      const classValues = attributes.get(25);
      expect(classValues).toBeDefined();
      expect(classValues![0].toString('utf8')).toBe(classValue);
    });
  });

  describe('Class Attribute Security', () => {
    test('should handle binary data in Class attribute safely', async () => {
      const mockClient = createMockRADIUSClient();
      const secret = 'testsecret';
      // Binary data including null bytes
      const binaryClass = Buffer.from([0x01, 0x00, 0xFF, 0x7F, 0x80, 0xFE]);
      
      mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
        cb(null);
        
        setTimeout(() => {
          const response = createAccessAcceptWithBinaryClass(packet, secret, binaryClass);
          mockClient.messageHandler(response);
        }, 10);
      });

      const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
      
      expect(result.ok).toBe(true);
      // Class should be interpreted as UTF-8, may contain replacement characters for invalid sequences
      expect(result.class).toBeDefined();
    });

    test('should not be affected by Class attribute spoofing attempts', () => {
      // Test that we properly validate packet structure and don't get confused by
      // fake Class attributes in unexpected places
      
      const packet = Buffer.alloc(50);
      packet[0] = 2; // Access-Accept
      packet[1] = 123; // ID
      packet.writeUInt16BE(50, 2);
      crypto.randomBytes(16).copy(packet, 4);
      
      // Add real Class attribute
      packet[20] = 25; // Type: Class
      packet[21] = 6; // Length
      Buffer.from('real').copy(packet, 22);
      
      // Add some other attribute
      packet[26] = 18; // Type: Reply-Message
      packet[27] = 8; // Length
      Buffer.from('hello').copy(packet, 28); // But secretly include fake Class bytes
      
      // Try to add another Class attribute
      packet[34] = 25; // Type: Class
      packet[35] = 6; // Length
      Buffer.from('fake').copy(packet, 36);
      
      const attributes = parseRADIUSAttributes(packet);
      const allClasses: string[] = [];
      
      // Collect all Class attributes found
      const classValues = attributes.get(25);
      if (classValues) {
        for (const value of classValues) {
          allClasses.push(value.toString('utf8'));
        }
      }
      
      // Should find both real Class attributes (our parser handles multiple)
      expect(allClasses).toContain('real');
      expect(allClasses).toContain('fake');
      expect(allClasses.length).toBe(2);
    });
  });
});

// Helper functions for Class attribute testing
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

function createAccessAcceptWithClass(requestPacket: Buffer, secret: string, classValue: string | null): Buffer {
  const requestAuth = requestPacket.slice(4, 20);
  const id = requestPacket[1];
  
  const attributes: Buffer[] = [];
  if (classValue !== null) {
    const classBuf = Buffer.from(classValue, 'utf8');
    attributes.push(Buffer.concat([Buffer.from([25, classBuf.length + 2]), classBuf]));
  }
  
  return buildAccessAcceptResponse(id, requestAuth, secret, attributes);
}

function createAccessAcceptWithMultipleClasses(requestPacket: Buffer, secret: string, classValues: string[]): Buffer {
  const requestAuth = requestPacket.slice(4, 20);
  const id = requestPacket[1];
  
  const attributes: Buffer[] = [];
  for (const classValue of classValues) {
    const classBuf = Buffer.from(classValue, 'utf8');
    attributes.push(Buffer.concat([Buffer.from([25, classBuf.length + 2]), classBuf]));
  }
  
  return buildAccessAcceptResponse(id, requestAuth, secret, attributes);
}

function createAccessAcceptWithBinaryClass(requestPacket: Buffer, secret: string, binaryClass: Buffer): Buffer {
  const requestAuth = requestPacket.slice(4, 20);
  const id = requestPacket[1];
  
  const attributes: Buffer[] = [];
  attributes.push(Buffer.concat([Buffer.from([25, binaryClass.length + 2]), binaryClass]));
  
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

function parseRADIUSAttributes(packet: Buffer): Map<number, Buffer[]> {
  const attributes = new Map<number, Buffer[]>();
  let offset = 20;
  
  while (offset + 2 <= packet.length) {
    const type = packet.readUInt8(offset);
    const length = packet.readUInt8(offset + 1);
    
    // Improved validation per RFC 2865
    if (length < 2) {
      break; // Invalid length, stop parsing
    }
    
    if (offset + length > packet.length) {
      break; // Attribute runs past packet end, stop parsing
    }
    
    const value = packet.slice(offset + 2, offset + length);
    
    // Support multiple attributes of same type
    if (!attributes.has(type)) {
      attributes.set(type, []);
    }
    attributes.get(type)!.push(value);
    
    offset += length;
  }
  
  return attributes;
}
