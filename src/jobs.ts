import { db } from './db';
import type { Submission, Task, User } from './citizens';
import { checkFollow, checkLike, checkRepost, lookupTweet, tweetIdOf, type Check } from './xapi';

const nowIso = () => new Date().toISOString();

async function verify(sub: Submission, task: Task, note: string | null = null) {
  // conditional update: only the first worker run that sees 'pending' awards the points
  const [done] = await db.update<Submission>('submissions', { id: sub.id, status: sub.status }, {
    status: 'verified',
    points_awarded: task.points,
    review_note: note,
    updated_at: nowIso(),
  });
  if (done) await db.addPoints(sub.user_id, task.points);
}

async function setStatus(sub: Submission, status: Submission['status'], note: string) {
  await db.update('submissions', { id: sub.id, status: sub.status }, { status, review_note: note, updated_at: nowIso() });
}

/** Runs one X API check for a submission. */
async function apiCheck(task: Task, sub: Submission, user: User): Promise<{ result: Check; note?: string }> {
  const target = tweetIdOf(task.target_url);
  switch (task.kind) {
    case 'follow':
      return { result: task.x_handle ? await checkFollow(user.x_id, task.x_handle) : 'unavailable', note: `We couldn't see you following @${task.x_handle}.` };
    case 'like':
      return { result: target ? await checkLike(target, user.x_id) : 'unavailable', note: "We couldn't find your like on the post." };
    case 'repost':
      return { result: target ? await checkRepost(target, user.x_id) : 'unavailable', note: "We couldn't find your repost." };
    case 'engage':
    case 'daily': {
      if (!target) return { result: 'unavailable' };
      const [l, r] = await Promise.all([checkLike(target, user.x_id), checkRepost(target, user.x_id)]);
      if (l === 'unavailable' || r === 'unavailable') return { result: 'unavailable' };
      return { result: l === 'yes' && r === 'yes' ? 'yes' : 'no', note: `We couldn't find your ${l !== 'yes' ? 'like' : 'repost'} on the post.` };
    }
    case 'quote':
    case 'reply':
    case 'post':
    case 'art': {
      if (!sub.tweet_id) return { result: 'unavailable' };
      const t = await lookupTweet(sub.tweet_id);
      if (t === 'unavailable') return { result: 'unavailable' };
      if (t === 'missing') return { result: 'no', note: 'That post is deleted or private.' };
      if (t.author_id !== user.x_id) return { result: 'no', note: 'That post is not from your X account.' };
      if (task.kind === 'quote' && !t.referenced_tweets?.some((r) => r.type === 'quoted' && r.id === target)) return { result: 'no', note: "That post doesn't quote the task's post." };
      if (task.kind === 'reply' && !t.referenced_tweets?.some((r) => r.type === 'replied_to' && r.id === target)) return { result: 'no', note: "That post isn't a reply to the task's post." };
      if (task.required_text && !t.text.toLowerCase().includes(task.required_text.toLowerCase())) return { result: 'no', note: `Your post needs to include “${task.required_text}”.` };
      return { result: 'yes' };
    }
    default:
      return { result: 'unavailable' };
  }
}

let running = false;
/** Settles due submissions: timed ones get their points, X-API ones are checked. */
export async function runVerifier() {
  if (running) return;
  running = true;
  try {
    const due = await db.select<Submission>('submissions', { where: { status: 'pending', verify_at: { lte: nowIso() } }, order: [['verify_at', 'asc']], limit: 200 });
    if (!due.length) return;
    const tasks = new Map((await db.select<Task>('tasks')).map((t) => [t.id, t]));
    for (const sub of due) {
      const task = tasks.get(sub.task_id);
      if (!task) continue;
      if (task.verify_mode !== 'x_api') {
        await verify(sub, task);
        continue;
      }
      const user = await db.one<User>('users', { id: sub.user_id });
      if (!user || user.status === 'banned') {
        await setStatus(sub, 'rejected', 'Account blocked.');
        continue;
      }
      const { result, note } = await apiCheck(task, sub, user);
      if (result === 'yes') await verify(sub, task, 'Checked on X.');
      else if (result === 'no') await setStatus(sub, 'rejected', note ?? "We couldn't verify this on X.");
      else await setStatus(sub, 'in_review', 'Sent to the team: X could not be checked automatically.');
    }
  } catch (e) {
    console.error('[verifier]', e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}

export function startJobs() {
  setInterval(() => void runVerifier(), 30_000).unref();
  void runVerifier();
}
