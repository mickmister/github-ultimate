import { execFileSync } from 'node:child_process';

export const uiBuild = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
