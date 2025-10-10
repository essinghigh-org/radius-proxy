// Test for Cisco-AVPair vendor-specific attribute support

import crypto from 'crypto';
import { radiusAuthenticate } from '@/lib/radius';
import { config, _invalidateConfigCache } from '@/lib/config';

describe('RADIUS Cisco-AVPair Support', () => {
  beforeAll(() => {
    // Configure for Cisco-AVPair
    process.env.RADIUS_ASSIGNMENT = '26';      // Vendor-Specific
    process.env.RADIUS_VENDOR_ID = '9';        // Cisco
    process.env.RADIUS_VENDOR_TYPE = '1';      // Cisco-AVPair
    process.env.RADIUS_VALUE_PATTERN = 'shell:roles=([^,\\s]+)';
    _invalidateConfigCache();
  });

  afterAll(() => {
    // Reset to default
    delete process.env.RADIUS_ASSIGNMENT;
    delete process.env.RADIUS_VENDOR_ID;
    delete process.env.RADIUS_VENDOR_TYPE;
    delete process.env.RADIUS_VALUE_PATTERN;
    _invalidateConfigCache();
  });

  test('should extract role from Cisco-AVPair "shell:roles=network-admin"', async () => {
    // Verify config is using Cisco-AVPair
    expect(config.RADIUS_ASSIGNMENT).toBe(26);
    expect(config.RADIUS_VENDOR_ID).toBe(9);
    expect(config.RADIUS_VENDOR_TYPE).toBe(1);
    expect(config.RADIUS_VALUE_PATTERN).toBe('shell:roles=([^,\\s]+)');

    const mockClient = createMockRADIUSClient();
    const secret = 'testsecret';
    const roleValue = 'network-admin';
    
    mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
      cb(null);
      
      setTimeout(() => {
        // Create response with Cisco-AVPair containing "shell:roles=network-admin"
        const response = createAccessAcceptWithCiscoAVPair(packet, secret, `shell:roles=${roleValue}`);
        mockClient.messageHandler(response);
      }, 10);
    });

    const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
    
    expect(result.ok).toBe(true);
    expect(result.class).toBe(roleValue);
  });

  test('should handle multiple roles in Cisco-AVPair', async () => {
    const mockClient = createMockRADIUSClient();
    const secret = 'testsecret';
    
    mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
      cb(null);
      
      setTimeout(() => {
        // Create response with multiple Cisco-AVPairs
        const response = createAccessAcceptWithMultipleCiscoAVPairs(packet, secret, [
          'shell:roles=network-admin',
          'shell:roles=security-admin'
        ]);
        mockClient.messageHandler(response);
      }, 10);
    });

    const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
    
    expect(result.ok).toBe(true);
    // Should take the first role found
    expect(result.class).toBe('network-admin');
  });

  test('should ignore non-matching Cisco-AVPairs', async () => {
    const mockClient = createMockRADIUSClient();
    const secret = 'testsecret';
    
    mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
      cb(null);
      
      setTimeout(() => {
        // Create response with non-role Cisco-AVPairs and one role AVPair
        const response = createAccessAcceptWithMultipleCiscoAVPairs(packet, secret, [
          'cisco-nas-port=FastEthernet0/1',
          'shell:roles=network-admin',
          'other-setting=value'
        ]);
        mockClient.messageHandler(response);
      }, 10);
    });

    const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
    
    expect(result.ok).toBe(true);
    expect(result.class).toBe('network-admin');
  });

  test('should handle missing role pattern gracefully', async () => {
    const mockClient = createMockRADIUSClient();
    const secret = 'testsecret';
    
    mockClient.mockSocket.send.mockImplementation((packet: Buffer, port: number, host: string, cb: Function) => {
      cb(null);
      
      setTimeout(() => {
        // Create response with Cisco-AVPair that doesn't match the pattern
        const response = createAccessAcceptWithCiscoAVPair(packet, secret, 'cisco-nas-port=FastEthernet0/1');
        mockClient.messageHandler(response);
      }, 10);
    });

    const result = await radiusAuthenticate('127.0.0.1', secret, 'testuser', 'testpass', 5000);
    
    expect(result.ok).toBe(true);
    expect(result.class).toBeUndefined();
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

function createAccessAcceptWithCiscoAVPair(requestPacket: Buffer, secret: string, avpairValue: string): Buffer {
  const requestAuth = requestPacket.slice(4, 20);
  const id = requestPacket[1];
  
  const attributes: Buffer[] = [];
  
  // Create Cisco-AVPair (Vendor-Specific Attribute)
  // Attribute Type: 26 (Vendor-Specific)
  // Vendor-ID: 9 (Cisco) - 4 bytes
  // Vendor-Type: 1 (Cisco-AVPair) - 1 byte
  // Vendor-Length: length of vendor data + 2 - 1 byte
  // Value: the actual AVPair string
  
  const avpairBuf = Buffer.from(avpairValue, 'utf8');
  const vendorData = Buffer.alloc(6 + avpairBuf.length);
  vendorData.writeUInt32BE(9, 0);              // Cisco Vendor-ID
  vendorData.writeUInt8(1, 4);                 // Cisco-AVPair type
  vendorData.writeUInt8(avpairBuf.length + 2, 5); // Vendor length
  avpairBuf.copy(vendorData, 6);               // AVPair value
  
  // VSA: Type=26, Length=vendorData.length+2, Value=vendorData
  attributes.push(Buffer.concat([Buffer.from([26, vendorData.length + 2]), vendorData]));
  
  return buildAccessAcceptResponse(id, requestAuth, secret, attributes);
}

function createAccessAcceptWithMultipleCiscoAVPairs(
  requestPacket: Buffer, 
  secret: string, 
  avpairValues: string[]
): Buffer {
  const requestAuth = requestPacket.slice(4, 20);
  const id = requestPacket[1];
  
  const attributes: Buffer[] = [];
  
  for (const avpairValue of avpairValues) {
    const avpairBuf = Buffer.from(avpairValue, 'utf8');
    const vendorData = Buffer.alloc(6 + avpairBuf.length);
    vendorData.writeUInt32BE(9, 0);              // Cisco Vendor-ID
    vendorData.writeUInt8(1, 4);                 // Cisco-AVPair type
    vendorData.writeUInt8(avpairBuf.length + 2, 5); // Vendor length
    avpairBuf.copy(vendorData, 6);               // AVPair value
    
    // VSA: Type=26, Length=vendorData.length+2, Value=vendorData
    attributes.push(Buffer.concat([Buffer.from([26, vendorData.length + 2]), vendorData]));
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