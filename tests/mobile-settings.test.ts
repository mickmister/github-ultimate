import { expect, it } from 'vitest';
import { MobileSettingsStore } from '../src/mobile-settings';

it('restores the confirmed deployment and independent permissions after a cold restart', async () => {
  const disk = new Map<string, string>();
  const storage = { async getItem(key: string) { return disk.get(key) ?? null; }, async setItem(key: string, value: string) { disk.set(key, value); } };
  const settings = new MobileSettingsStore(storage);
  expect(await settings.load()).toBeUndefined();
  const chosen = { entryURL: 'https://pages.example/project/app/', fixtureApproved: false, storageApproved: true };
  await settings.save(chosen);
  expect(await new MobileSettingsStore(storage).load()).toEqual(chosen);
  await settings.save({ ...chosen, storageApproved: false });
  expect((await new MobileSettingsStore(storage).load())?.storageApproved).toBe(false);
});

it('rejects corrupted/non-HTTPS saved settings instead of loading or granting them', async () => {
  for (const raw of ['bad JSON', JSON.stringify({ entryURL: 'http://pages.example/', fixtureApproved: true, storageApproved: true }), JSON.stringify({ entryURL: 'https://pages.example/', fixtureApproved: 'true', storageApproved: true })]) {
    const settings = new MobileSettingsStore({ async getItem() { return raw; }, async setItem() {} });
    await expect(settings.load()).rejects.toThrow();
  }
});

it('serializes settings changes and reports persistence failures without claiming they were saved', async () => {
  let saved = '', fail = false;
  const storage = { async getItem() { return saved || null; }, async setItem(_key: string, value: string) { if (fail) throw new Error('disk full'); saved = value; } };
  const settings = new MobileSettingsStore(storage), initial = { entryURL: 'https://pages.example/app/', fixtureApproved: true, storageApproved: true };
  await Promise.all([settings.save(initial), settings.save({ ...initial, storageApproved: false })]);
  expect((await settings.load())?.storageApproved).toBe(false);
  fail = true;
  await expect(settings.save({ ...initial, entryURL: 'https://other.example/app/' })).rejects.toThrow('disk full');
  expect((await new MobileSettingsStore(storage).load())?.entryURL).toBe(initial.entryURL);
});
