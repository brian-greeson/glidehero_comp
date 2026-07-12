import { Router } from 'express';
import { getAuth } from '../middleware/authMiddleware.js';

const templateRouter = Router();
templateRouter.get('/template', async (req, res) => {
  const player = getAuth(req);
  res.status(200).json({ template: 'template' });
});

export default templateRouter;
