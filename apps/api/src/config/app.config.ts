import { corsOrigins, redisConnection } from './runtime-config';

export const appConfig = () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: redisConnection(),

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-refresh-in-production',
    accessExpiresIn: '15m',
    // AE-19: shorter window for a token that lives in localStorage.
    refreshExpiresIn: '24h',
  },

  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'erp_minio',
    secretKey: process.env.MINIO_SECRET_KEY || 'erp_minio_secret',
    bucket: process.env.MINIO_BUCKET || 'erp-files',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },

  cors: {
    origin: corsOrigins(),
  },

  // Mercado Livre
  mercadoLivre: {
    appId: process.env.ML_APP_ID,
    clientSecret: process.env.ML_CLIENT_SECRET,
    redirectUri: process.env.ML_REDIRECT_URI,
  },

  // Shopee
  shopee: {
    partnerId: process.env.SHOPEE_PARTNER_ID,
    partnerKey: process.env.SHOPEE_PARTNER_KEY,
  },
});
