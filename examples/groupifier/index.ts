import { finish, loadSession, requiredArgument } from '../support';
import { GROUPIFIER_OPTIONS } from './config';
import { planLikeGroupifier } from './plan';

if (import.meta.main) {
  const competitionId = requiredArgument(0, 'competition id');
  const session = await loadSession(competitionId);
  const result = await planLikeGroupifier(session, GROUPIFIER_OPTIONS);
  console.log(result);
  await finish(session);
}
