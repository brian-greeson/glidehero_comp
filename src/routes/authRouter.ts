import { Router } from 'express';
import {
  authenticateRefreshToken,
  exchangeAppleCredentials,
  passwordLogin,
  passwordSignup,
} from '../services/authService.js';
import {
  authAppleExchangeSchema,
  passwordLoginSchema,
  passwordSignupSchema,
  refreshTokenSchema,
} from '../validation/authValidators.js';
import { parseOrThrow } from '../validation/validation.js';

const authRouter = Router();

authRouter.post('/auth/apple/exchange', async (req, res) => {
  const input = parseOrThrow(authAppleExchangeSchema, req.body);
  const appleAuthResponse = await exchangeAppleCredentials(input);
  res.status(200).json(appleAuthResponse);
});

authRouter.post('/auth/login', async (req, res) => {
  const creds = parseOrThrow(passwordLoginSchema, req.body);
  const loginResponse = await passwordLogin(creds);
  return res.status(200).json(loginResponse);
});

authRouter.post('/auth/signup', async (req, res) => {
  const input = parseOrThrow(passwordSignupSchema, req.body);
  const player = await passwordSignup(input);
  return res.status(200).json({ player });
});

authRouter.post('/auth/refresh', async (req, res) => {
  const { refreshToken } = parseOrThrow(refreshTokenSchema, req.body);
  const tokenRefreshResponse = await authenticateRefreshToken(refreshToken);
  return res.status(200).json(tokenRefreshResponse);
});
export default authRouter;
