import { execFileSync } from 'node:child_process';

export const uiBuild = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
