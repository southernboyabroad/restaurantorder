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
  schedulerEnabled: optional('SCHEDULER_ENABLED', 'false').toLowerCase() === 'true',
  testPhoneNumber: optional('TEST_PHONE_NUMBER', ''),
  adminPhoneNumber: optional('ADMIN_PHONE_NUMBER', ''),

  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    phoneNumber: required('TWILIO_PHONE_NUMBER'),
  },

  google: {
    serviceAccountKeyBase64: required('GOOGLE_SERVICE_ACCOUNT_KEY_BASE64'),
    sheetId: required('GOOGLE_SHEET_ID'),
    deliverySheetId: required('DELIVERY_SHEET_ID'),
    sheetId25252: optional('SHEET_ID_25252', ''),
    sheetId25248: optional('SHEET_ID_25248', ''),
  },

  sendgrid: {
    apiKey: optional('SENDGRID_API_KEY', ''),
    fromEmail: optional('SENDGRID_FROM_EMAIL', ''),
    warehouseEmail: required('WAREHOUSE_EMAIL'),
  },

  resend: {
    apiKey: required('RESEND_API_KEY'),
    fromEmail: required('RESEND_FROM_EMAIL'),
  },

  openai: {
    apiKey: optional('OPENAI_API_KEY', ''),
  },

  emailSignOffName: optional('EMAIL_SIGN_OFF_NAME', 'Bryant'),

  products: optional('PRODUCTS', 'toast,4-inch,long,institutional_sandwich,dinner_rolls,hoagie,top_slice,marty,plain_marty,5-inch,potato_bread,slider')
    .split(',')
    .map((p) => p.trim().toLowerCase()),
} as const;
