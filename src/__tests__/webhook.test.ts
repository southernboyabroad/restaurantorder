jest.mock('../config', () => ({
  config: {
    products: ['chicken', 'ribs', 'pulled_pork', 'brisket', 'coleslaw', 'beans'],
    twilio: {
      accountSid: 'ACtest',
      authToken: 'test_token',
      phoneNumber: '+15550000000',
    },
    openai: { apiKey: '' },
  },
}));

jest.mock('../services/sms', () => ({
  sendSms: jest.fn().mockResolvedValue('SM_test'),
  validateTwilioWebhook: jest.fn().mockReturnValue(true),
}));

jest.mock('../services/sheets', () => ({
  findCustomerByPhone: jest.fn(),
  appendOrder: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/orderParser', () => ({
  parseOrder: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import { webhookRouter } from '../services/webhook';
import { findCustomerByPhone } from '../services/sheets';
import { parseOrder } from '../services/orderParser';
import { sendSms } from '../services/sms';

const app = express();
app.use('/', webhookRouter);

const mockFindCustomer = findCustomerByPhone as jest.MockedFunction<typeof findCustomerByPhone>;
const mockParseOrder = parseOrder as jest.MockedFunction<typeof parseOrder>;
const mockSendSms = sendSms as jest.MockedFunction<typeof sendSms>;

// We need supertest for HTTP testing
// It's not in package.json, so these tests show the expected behavior
// Install with: npm install --save-dev supertest @types/supertest

describe('POST /sms webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('returns 200 and records order for known customer with valid order', async () => {
    mockFindCustomer.mockResolvedValue({ name: 'Alice', phone: '+15551111111' });
    mockParseOrder.mockResolvedValue({ quantities: { chicken: 10 }, confident: true });

    const res = await request(app)
      .post('/sms')
      .type('form')
      .send({ Body: 'chicken 10', From: '+15551111111' });

    expect(res.status).toBe(200);
    expect(mockSendSms).toHaveBeenCalledWith(
      '+15551111111',
      expect.stringContaining('Thanks Alice'),
    );
  });

  it('rejects unknown phone numbers politely', async () => {
    mockFindCustomer.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/sms')
      .type('form')
      .send({ Body: 'chicken 10', From: '+15559999999' });

    expect(res.status).toBe(200);
    expect(mockSendSms).toHaveBeenCalledWith(
      '+15559999999',
      expect.stringContaining("don't have your number"),
    );
  });

  it('asks customer to retry when order cannot be parsed', async () => {
    mockFindCustomer.mockResolvedValue({ name: 'Bob', phone: '+15552222222' });
    mockParseOrder.mockResolvedValue({ quantities: {}, confident: false });

    const res = await request(app)
      .post('/sms')
      .type('form')
      .send({ Body: 'hello', From: '+15552222222' });

    expect(res.status).toBe(200);
    expect(mockSendSms).toHaveBeenCalledWith(
      '+15552222222',
      expect.stringContaining("couldn't understand"),
    );
  });

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
