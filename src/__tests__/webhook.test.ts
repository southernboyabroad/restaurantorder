jest.mock('../config', () => ({
  config: {
    products: ['toast', '4-inch', 'long', 'institutional_sandwich', 'dinner_rolls'],
    twilio: {
      accountSid: 'ACtest',
      authToken: 'test_token',
      phoneNumber: '+15550000000',
    },
    sendgrid: {
      apiKey: 'SG.test',
      fromEmail: 'test@example.com',
      warehouseEmail: 'warehouse@example.com',
    },
    openai: { apiKey: '' },
    emailSignOffName: 'Bryant',
  },
}));

jest.mock('../services/sms', () => ({
  sendSms: jest.fn().mockResolvedValue('SM_test'),
  validateTwilioWebhook: jest.fn().mockReturnValue(true),
}));

jest.mock('../services/sheets', () => ({
  findCustomerByPhone: jest.fn(),
  appendOrder: jest.fn().mockResolvedValue(undefined),
  getTodaysOrders: jest.fn().mockResolvedValue([]),
  markOrdersAsEmailed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/orderParser', () => ({
  parseOrder: jest.fn(),
  isAffirmativeReply: jest.fn().mockReturnValue(false),
}));

jest.mock('../services/email', () => ({
  sendWarehouseEmail: jest.fn().mockResolvedValue(undefined),
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

describe('POST /sms webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('returns 200 and records order for known customer with valid order', async () => {
    mockFindCustomer.mockResolvedValue({ name: 'Alice', phone: '+15551111111', route: '25252' });
    mockParseOrder.mockResolvedValue({ quantities: { toast: 10 }, confident: true });

    const res = await request(app)
      .post('/sms')
      .type('form')
      .send({ Body: 'toast 10', From: '+15551111111' });

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
      .send({ Body: 'toast 10', From: '+15559999999' });

    expect(res.status).toBe(200);
    expect(mockSendSms).toHaveBeenCalledWith(
      '+15559999999',
      expect.stringContaining("don't have your number"),
    );
  });

  it('asks customer to retry when order cannot be parsed', async () => {
    mockFindCustomer.mockResolvedValue({ name: 'Bob', phone: '+15552222222', route: '25248' });
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
