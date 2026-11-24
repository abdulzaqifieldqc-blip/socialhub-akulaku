import IORedis from "ioredis";
import { Queue } from "bullmq";

export const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
});

export const publishQueue = new Queue("social-publishing", {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 30000 },
    removeOnComplete: { age: 7 * 24 * 3600, count: 10000 },
    removeOnFail: { age: 30 * 24 * 3600, count: 20000 }
  }
});

export async function enqueuePlatformPost({ postId, userId, platform }) {
  return publishQueue.add(
    `publish:${platform}`,
    { postId: String(postId), userId: String(userId), platform },
    {
      jobId: `${postId}:${platform}`,
      // One job per post/platform prevents duplicate queue insertion.
      attempts: 5
    }
  );
}
