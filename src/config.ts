import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  logLevel: optional('LOG_LEVEL', 'info'),

  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    phoneNumber: required('TWILIO_PHONE_NUMBER'),
  },

  google: {
    serviceAccountKeyBase64: required('GOOGLE_SERVICE_ACCOUNT_KEY_BASE64'),
    sheetId: required('GOOGLE_SHEET_ID'),
  },

  sendgrid: {
    apiKey: required('SENDGRID_API_KEY'),
    fromEmail: required('SENDGRID_FROM_EMAIL'),
    warehouseEmail: required('WAREHOUSE_EMAIL'),
  },

  openai: {
    apiKey: optional('OPENAI_API_KEY', ''),
  },

  products: optional('PRODUCTS', 'chicken,ribs,pulled_pork,brisket,coleslaw,beans')
    .split(',')
    .map((p) => p.trim().toLowerCase()),
} as const;
