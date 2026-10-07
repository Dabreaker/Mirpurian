import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

export const DEFAULT_SECTIONS = [
  { slug: 'syllabus', name: 'Syllabus', icon: '📘' },
  { slug: 'notes', name: 'Notes', icon: '📝' },
  { slug: 'notice', name: 'Notice', icon: '📢' },
  { slug: 'suggestions', name: 'Suggestions', icon: '💡' },
  { slug: 'others', name: 'Others', icon: '📦' },
];

export async function getSections() {
  return (await redis.get('sections')) || DEFAULT_SECTIONS;
}
