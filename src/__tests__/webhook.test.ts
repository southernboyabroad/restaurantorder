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
    adminPhoneNumber: '',
  },
}));

jest.mock('../services/sms', () => ({
  sendSms: jest.fn().mockResolvedValue('SM_test'),
  forwardToAdmin: jest.fn().mockResolvedValue(undefined),
  validateTwilioWebhook: jest.fn().mockReturnValue(true),
  buildOrderPromptMessage: jest.fn().mockReturnValue(null),
  buildConfirmationMessage: jest.fn().mockReturnValue('Sounds good... Have a great afternoon!'),
}));

jest.mock('../services/sheets', () => ({
  findCustomerByPhone: jest.fn(),
  findCustomerByNameHint: jest.fn(),
  normalizePhone: jest.fn((raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return raw.startsWith('+') ? raw : `+${raw}`;
  }),
  appendOrder: jest.fn().mockResolvedValue(undefined),
  getTodaysOrders: jest.fn().mockResolvedValue([]),
  markOrdersAsEmailed: jest.fn().mockResolvedValue(undefined),
  getLastOrderForCustomer: jest.fn().mockResolvedValue(null),
  updateTodaysOrder: jest.fn().mockResolvedValue({ found: false, wasEmailed: false, mergedQuantities: {}, previousQuantities: {} }),
}));

jest.mock('../services/orderParser', () => ({
  parseOrder: jest.fn(),
  parseOrderStrict: jest.fn().mockReturnValue(null),
  isAffirmativeReply: jest.fn().mockReturnValue(false),
  isRepeatOrderRequest: jest.fn().mockReturnValue(false),
  parseCorrectionRequest: jest.fn().mockReturnValue(null),
  preprocessCorrectionText: jest.fn((text: string) => text.replace(/\s+to\s+(\d)/g, ' $1')),
}));

jest.mock('../services/email', () => ({
  sendWarehouseEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/deliveryTab', () => ({
  updateDeliveryTabOrder: jest.fn().mockResolvedValue(undefined),
}));

// Default: ordering window is open (so existing tests still work)
jest.mock('../services/orderingWindow', () => ({
  isInsideOrderingWindow: jest.fn().mockReturnValue(true),
}));

jest.mock('../services/orderSummary', () => ({
  formatOrderText: jest.fn().mockReturnValue('mock text'),
  formatOrderHtml: jest.fn().mockReturnValue('<p>mock html</p>'),
  getDeliveryDate: jest.fn().mockReturnValue(new Date('2026-02-18')),
  formatDeliveryDate: jest.fn().mockReturnValue('2/18'),
  deliveryDayName: jest.fn().mockReturnValue('Wednesday'),
}));

import express from 'express';
import request from 'supertest';
import { webhookRouter } from '../services/webhook';
import { findCustomerByPhone } from '../services/sheets';
import { parseOrder } from '../services/orderParser';
import { sendSms } from '../services/sms';
import { isInsideOrderingWindow } from '../services/orderingWindow';

const app = express();
app.use('/', webhookRouter);

const mockFindCustomer = findCustomerByPhone as jest.MockedFunction<typeof findCustomerByPhone>;
const mockParseOrder = parseOrder as jest.MockedFunction<typeof parseOrder>;
const mockSendSms = sendSms as jest.MockedFunction<typeof sendSms>;
const mockIsInsideOrderingWindow = isInsideOrderingWindow as jest.MockedFunction<typeof isInsideOrderingWindow>;

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
      expect.stringContaining('Sounds good'),
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

  it('ignores inbound SMS outside the ordering window (no bot reply)', async () => {
    mockIsInsideOrderingWindow.mockReturnValue(false);

    const res = await request(app)
      .post('/sms')
      .type('form')
      .send({ Body: 'toast 10', From: '+15551111111' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response></Response>');
    // The bot should NOT have sent any SMS reply
    expect(mockSendSms).not.toHaveBeenCalled();
    // Restore for other tests
    mockIsInsideOrderingWindow.mockReturnValue(true);
  });

  it('processes orders inside the ordering window', async () => {
    mockIsInsideOrderingWindow.mockReturnValue(true);
    mockFindCustomer.mockResolvedValue({ name: 'Alice', phone: '+15551111111', route: '25252' });
    mockParseOrder.mockResolvedValue({ quantities: { toast: 10 }, confident: true });

    const res = await request(app)
      .post('/sms')
      .type('form')
      .send({ Body: 'toast 10', From: '+15551111111' });

    expect(res.status).toBe(200);
    expect(mockSendSms).toHaveBeenCalled();
  });
});
