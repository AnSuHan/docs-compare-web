import { buildFixtures } from './fixtures';

/** 시나리오가 올릴 문서를 먼저 만든다. 저장소에는 바이너리를 두지 않는다. */
export default async function globalSetup(): Promise<void> {
  await buildFixtures();
}
