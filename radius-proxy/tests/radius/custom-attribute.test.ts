// Test for custom RADIUS attribute (e.g., Management-Policy-Id = 136)

import crypto from 'crypto';
import { radiusAuthenticate } from '@/lib/radius';
import { config, _invalidateConfigCache } from '@/lib/config';

describe('RADIUS Custom Attribute Support', () => {
  beforeAll(() => {
    // Set custom attribute number (Management-Policy-Id)
    process.env.RADIUS_ASSIGNMENT = '136';
    _invalidateConfigCache();
  });

  afterAll(() => {
    // Reset to default
    delete process.env.RADIUS_ASSIGNMENT;
    _invalidateConfigCache();
  });

  test('should use custom attribute 136 instead of Class (25)', async () => {
    // Verify config is using our custom attribute
    expect(config.RADIUS_ASSIGNMENT).toBe(136);

    const mockClient = createMockRADIUSClient();
    const secret = 'testsecret';
    const groupValue = 'management_group';
    
    mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
      cb(null);
      
      setTimeout(() => {
        // Create response with attribute 136 instead of 25
        const response = createAccessAcceptWithCustomAttribute(packet, secret, groupValue, 136);
        mockClient.messageHandler(response);
      }, 10);
    });

    const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
    
    expect(result.ok).toBe(true);
    expect(result.class).toBe(groupValue);
  });

  test('should ignore old Class attribute (25) when using custom attribute', async () => {
    const mockClient = createMockRADIUSClient();
    const secret = 'testsecret';
    const managementValue = 'management_role';
    const classValue = 'old_class_value';
    
    mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
      cb(null);
      
      setTimeout(() => {
        // Create response with both attribute 25 (Class) and 136 (Management-Policy-Id)
        const response = createAccessAcceptWithMultipleAttributes(packet, secret, {
          25: classValue,      // Old Class attribute
          136: managementValue // New Management-Policy-Id attribute
        });
        mockClient.messageHandler(response);
      }, 10);
    });

    const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
    
    expect(result.ok).toBe(true);
    // Should pick up the Management-Policy-Id (136) value, not the Class (25) value
    expect(result.class).toBe(managementValue);
    expect(result.class).not.toBe(classValue);
  });
});

// Helper functions
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

function createAccessAcceptWithCustomAttribute(requestPacket: Buffer, secret: string, value: string, attributeType: number): Buffer {
  const requestAuth = requestPacket.slice(4, 20);
  const id = requestPacket[1];
  
  const attributes: Buffer[] = [];
  const valueBuf = Buffer.from(value, 'utf8');
  attributes.push(Buffer.concat([Buffer.from([attributeType, valueBuf.length + 2]), valueBuf]));
  
  return buildAccessAcceptResponse(id, requestAuth, secret, attributes);
}

function createAccessAcceptWithMultipleAttributes(
  requestPacket: Buffer, 
  secret: string, 
  attributeMap: Record<number, string>
): Buffer {
  const requestAuth = requestPacket.slice(4, 20);
  const id = requestPacket[1];
  
  const attributes: Buffer[] = [];
  for (const [attrType, attrValue] of Object.entries(attributeMap)) {
    const valueBuf = Buffer.from(attrValue, 'utf8');
    attributes.push(Buffer.concat([Buffer.from([parseInt(attrType), valueBuf.length + 2]), valueBuf]));
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