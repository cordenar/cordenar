import { createHash } from 'node:crypto';

export function computeHash(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}
