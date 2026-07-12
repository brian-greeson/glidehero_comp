import { Router } from 'express';
import { getAuth } from '../middleware/authMiddleware.js';
import { getProfile, updateProfile } from '../services/profileService.js';
import { validateUpdateProfile } from '../validation/profileValidators.js';

const profileRouter = Router();
profileRouter.get('/profile', async (req, res) => {
  const user = getAuth(req);
  res.status(200).json({ profile: await getProfile({ userId: user.id }) });
});

profileRouter.patch('/profile', async (req, res) => {
  const user = getAuth(req);
  const input = validateUpdateProfile(req.body);
  const profile = await updateProfile(user.id, input);
  res.status(200).json({ profile });
});

profileRouter.get('/profile/:profile_id', async (req, res) => {
  const profileId = req.params.profile_id;
  res.status(200).json({ profile: await getProfile({ profileId }) });
});

export default profileRouter;
