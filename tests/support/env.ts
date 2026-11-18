export const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/ninebike_test';
export const API_URL = process.env.TEST_API_DATABASE_URL ?? 'postgres://ninebike_api:ninebike_api_test@127.0.0.1:54329/ninebike_test';
export const JWT_SECRET = 'test-secret-test-secret-test-secret-123';
export const ISSUER = 'ninebike-test';
