import { Router } from 'express';
import { db } from '../db/client.js';
import { config } from '../config.js';
import { sql } from 'drizzle-orm';
import { s3Client } from '../resources/bucketClient.js';
import { CreateBucketCommand, ListBucketsCommand } from '@aws-sdk/client-s3';
let logEnabled = false;

const toolsRouter = Router();
toolsRouter.get('/v1/up', (req, res) => {
  return res.status(200).json({ ok: true, rc: config.release });
});
toolsRouter.get('/v1/log', (req, res) => {
  logEnabled = !logEnabled;
  return res.status(200).json({ enable: logEnabled });
});
toolsRouter.get('/v1/db', async (req, res) => {
  const { rows } = await db.execute(sql`
      
      SELECT table_name
      
      FROM information_schema.tables
      
      WHERE table_schema = 'public'
      
      ORDER BY table_name;
      
      `);

  return res.status(200).json(rows);
});

toolsRouter.get('/s3', async (req, res) => {
  // await s3Client.send(new CreateBucketCommand({ Bucket: 'my-new-space' }));
  const { Buckets } = await s3Client.send(new ListBucketsCommand({}));
  console.log(Buckets?.map((b: any) => b.Name));
});

export { toolsRouter };
